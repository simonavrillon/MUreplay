"""Replay session: one decomposition and its edit log, replayed step by step on the server."""

from __future__ import annotations

import itertools
import logging
import math
import threading
from collections.abc import Callable, Sequence
from dataclasses import dataclass, field
from typing import Any

import numpy as np

from mureplay.errors import MureplayError
from mureplay.models import FloatArray, IntArray, resident_nbytes
from mureplay.replay.artifact_mask import build_manual_artifact_mask
from mureplay.replay.filter_update import (
    edge_samples,
    emg_filter_inplace,
    spike_array,
    update_motor_unit_filter_window,
)
from mureplay.replay.operations import (
    apply_diff,
    inactive_mus_before,
    is_artifact_step,
    sample_array,
    step_type,
)
from mureplay.storage import SessionStore, StoreClosedError

logger = logging.getLogger(__name__)

SESSION_EXPIRED = "This replay is no longer open; open the trial again."
#: The intramuscular grids of MUedit2's catalogue (``signal/grid.py``), matched as substrings
#: of the grid name like MUedit2 does; every other grid takes the surface bandpass.
_INTRAMUSCULAR_GRIDS = ("MYOMRF-4x8", "MYOMNP-1x32")
#: Samples of a pulse train copied at once into a refit's new row.
_COPY_BLOCK = 1 << 22
_REFIT_FAILED = "The filter could not be recomputed; the server's terminal says why."

#: ``(key, row)`` of an MU's pulse train in ``ReplaySession.arrays``; None when the file has
#: no pulse trains for it, and a binary train is drawn from its discharge times instead.
PulseRef = tuple[str, int] | None
#: ``(grid, store)`` → the grid's raw EMG over the whole recording from the BIDS dataset,
#: written into ``store`` as writable float32 rows, with its fsamp and discard mask.
BidsGridReader = Callable[[int, SessionStore], tuple[FloatArray, float, IntArray]]


class ReplayError(MureplayError):
    """A replay request the session cannot carry out."""


def initial_mu_uids(mu_grid_index: Sequence[int]) -> list[str]:
    """MU uids as MUedit2 numbers the MUs of a file that has none: ``g<grid>_mu<n>``, per grid from 0."""
    counts: dict[int, int] = {}
    uids = []
    for grid in mu_grid_index:
        n = counts.get(int(grid), 0)
        counts[int(grid)] = n + 1
        uids.append(f"g{int(grid)}_mu{n}")
    return uids


def grid_emg_type(grid_name: str) -> int:
    """The bandpass MUedit2 filters ``grid_name`` with: 2 for intramuscular, 1 for surface."""
    return 2 if any(key in grid_name for key in _INTRAMUSCULAR_GRIDS) else 1


def _logged_int(entry: dict[str, Any], key: str, default: int) -> int:
    """A sample position a step logs, rounded half up as the page rounds it; ``default`` when it logs none."""
    try:
        return math.floor(float(entry[key]) + 0.5)
    except (KeyError, TypeError, ValueError, OverflowError):
        return default


@dataclass
class _Undo:
    """A step applied forward, and the rows of its MU before it (none for a step on no MU)."""

    step: int
    mu: int | None
    spike_times: IntArray | None = None
    artifact_times: IntArray | None = None
    row: PulseRef = None


@dataclass
class Change:
    """What a seek changed: the MUs whose rows moved, and the refits that fell back to the log."""

    changed: list[int] = field(default_factory=list)
    refit_errors: list[dict[str, Any]] = field(default_factory=list)  # {"step", "message"}


class ReplaySession:
    """Full-resolution state of one replay: the decomposition at the steps applied so far."""

    def __init__(
        self,
        *,
        store: SessionStore,
        total_samples: int,
        spike_times: Sequence[Any],
        pulse_trains: FloatArray | None,
        mu_grid_index: list[int],
        mu_uids: list[str],
        grid_names: list[str],
        history: list[dict[str, Any]],
        refit_settings: dict[str, Any],
        bids_grid: BidsGridReader,
        artifact_times: Sequence[Any] | None = None,
        artifact_regions: list[list[int]] | None = None,
        rewind: bool = False,
    ) -> None:
        n_mu = len(spike_times)
        self.store = store
        self.total_samples = int(total_samples)
        self.mu_grid_index = [int(g) for g in mu_grid_index]
        self.mu_uids = [str(u) for u in mu_uids]
        self.grid_names = list(grid_names)
        self.history = list(history)
        self.refit_settings = dict(refit_settings)
        self.artifact_regions = [(int(s), int(e)) for s, e in artifact_regions or []]
        self.bids_grid = bids_grid
        self.lock = threading.RLock()
        self.meta: dict[str, Any] = {}  # file fields the client shows
        self._filtered: dict[int, tuple[FloatArray, float, IntArray]] = {}
        # One lock per grid, so a grid filters once while a seek waits under ``lock``.
        self._filter_locks: dict[int, threading.Lock] = {}
        self._filter_locks_guard = threading.Lock()
        self._closed = False

        self.arrays: dict[str, np.ndarray] = {}
        has_pulse = (
            pulse_trains is not None and pulse_trains.ndim == 2 and pulse_trains.shape[0] == n_mu
        )
        if has_pulse:
            assert pulse_trains is not None
            self.arrays["base"] = pulse_trains
        self.rows: list[PulseRef] = [("base", i) if has_pulse else None for i in range(n_mu)]
        self.spike_times = [spike_array(s) for s in spike_times]
        raw_artifacts = list(artifact_times or [])
        self.artifact_times = [
            sample_array(raw_artifacts[i] if i < len(raw_artifacts) else []) for i in range(n_mu)
        ]
        if rewind:
            self._rewind()
        self._counter = itertools.count(1)
        self.versions = [next(self._counter) for _ in range(n_mu)]
        self.undo_stack: list[_Undo] = []

    # ── state ───────────────────────────────────────────────────────────────

    @property
    def n_mu(self) -> int:
        return len(self.spike_times)

    @property
    def closed(self) -> bool:
        return self._closed

    @property
    def applied(self) -> list[int]:
        """The steps applied so far, in order."""
        return [undo.step for undo in self.undo_stack]

    @property
    def nbytes(self) -> int:
        """Heap bytes: discharge times, artifact markers and undo snapshots; mapped arrays count 0."""
        arrays: list[np.ndarray] = [*self.spike_times, *self.artifact_times]
        for undo in list(self.undo_stack):
            arrays += [a for a in (undo.spike_times, undo.artifact_times) if a is not None]
        # A snapshot: this runs under the budget lock, not ``lock``, while a seek changes them.
        arrays += list(self.arrays.values())
        arrays += [emg for emg, _, _ in list(self._filtered.values())]
        return sum(resident_nbytes(a) for a in arrays)

    def check_mu(self, mu: object) -> int:
        """``mu`` as a valid MU index; a request may send anything."""
        if not isinstance(mu, int) or not 0 <= mu < self.n_mu:
            raise ReplayError(f"MU {mu} is out of range; the trial has {self.n_mu} MUs.", "mu")
        return mu

    def values(self, mu: int, start: int, end: int) -> FloatArray:
        """The MU's pulse train over ``[start, end)``: read-only (a copy for a drawn train)."""
        start, end = max(0, start), min(self.total_samples, end)
        ref = self.rows[mu]
        if ref is not None:
            key, row = ref
            view = self.arrays[key][row, start:end].view()
            view.flags.writeable = False
            return view
        drawn = np.zeros(max(0, end - start), dtype=np.float32)
        spikes = self.spike_times[mu]
        inside = spikes[(spikes >= start) & (spikes < end)]
        drawn[inside - start] = 1.0
        return drawn

    def values_at(self, mu: int, times: IntArray) -> FloatArray:
        """The MU's pulse train at ``times`` (float32)."""
        times = np.asarray(times, dtype=np.int64)
        ref = self.rows[mu]
        if ref is None:
            return np.isin(times, self.spike_times[mu]).astype(np.float32)
        key, row = ref
        out = np.zeros(times.shape, dtype=np.float32)
        ok = (times >= 0) & (times < self.total_samples)
        out[ok] = self.arrays[key][row, times[ok]]
        return out

    def _mu_of(self, entry: dict[str, Any]) -> int | None:
        """The MU a step names by uid; None for a step on no MU, or on one the file no longer has."""
        uid = str(entry.get("mu_uid") or "")
        return self.mu_uids.index(uid) if uid in self.mu_uids else None

    def _touch(self, mu: int) -> None:
        self.versions[mu] = next(self._counter)

    def _rewind(self) -> None:
        """Undo every logged diff, last first: the decomposition an ``_edited.npz`` started from."""
        for entry in reversed(self.history):
            mu = self._mu_of(entry)
            if mu is not None:
                self._apply_logged_diff(entry, mu, backward=True)

    # ── seeking ─────────────────────────────────────────────────────────────

    def seek(self, steps: Sequence[int]) -> Change:
        """Undo and apply steps until exactly ``steps`` are applied, in that order; call under ``lock``."""
        steps = list(steps)
        if len(set(steps)) != len(steps) or any(not 0 <= s < len(self.history) for s in steps):
            raise ReplayError("The steps to replay are not steps of this edit log.", "steps")
        applied = self.applied
        kept = 0
        while kept < min(len(applied), len(steps)) and applied[kept] == steps[kept]:
            kept += 1
        change = Change()
        changed: set[int] = set()
        while len(self.undo_stack) > kept:
            mu = self._undo()
            if mu is not None:
                changed.add(mu)
        for step in steps[kept:]:
            mu = self._apply(step, change)
            if mu is not None:
                changed.add(mu)
        change.changed = sorted(changed)
        return change

    def _apply(self, step: int, change: Change) -> int | None:
        """Apply ``history[step]``: its logged diff, or a refit for ``update_filter``."""
        entry = self.history[step]
        mu = self._mu_of(entry)
        if mu is None:
            self.undo_stack.append(_Undo(step, None))
            return None
        self.undo_stack.append(
            _Undo(step, mu, self.spike_times[mu], self.artifact_times[mu], self.rows[mu])
        )
        if step_type(entry) == "update_filter":
            # A refit that fails is replayed from the log instead, and the page says why; the
            # refit writes the MU's rows last, so a failure leaves them as they were.
            try:
                self._refit(step, entry, mu)
            except MureplayError as exc:
                self._apply_logged_diff(entry, mu)
                change.refit_errors.append({"step": step, "message": str(exc)})
            except Exception:
                logger.exception("Refit of step %d failed", step)
                self._apply_logged_diff(entry, mu)
                change.refit_errors.append({"step": step, "message": _REFIT_FAILED})
        else:
            self._apply_logged_diff(entry, mu)
        self._touch(mu)
        return mu

    def _apply_logged_diff(self, entry: dict[str, Any], mu: int, *, backward: bool = False) -> None:
        """Apply a step's logged diff to its MU's artifact markers or discharges, or undo it."""
        kind = "artifacts" if is_artifact_step(entry) else "spikes"
        rows = self.artifact_times if kind == "artifacts" else self.spike_times
        added = sample_array(entry.get(f"{kind}_added"))
        removed = sample_array(entry.get(f"{kind}_removed"))
        if backward:
            added, removed = removed, added
        rows[mu] = apply_diff(rows[mu], added, removed)

    def _undo(self) -> int | None:
        """Restore the rows the newest step replaced; the MU it was on, if any."""
        undo = self.undo_stack.pop()
        if undo.mu is None:
            return None
        mu = undo.mu
        assert undo.spike_times is not None and undo.artifact_times is not None
        self.spike_times[mu] = undo.spike_times
        self.artifact_times[mu] = undo.artifact_times
        self.rows[mu] = undo.row
        self._touch(mu)
        self._drop_unused_rows()
        return mu

    def _drop_unused_rows(self) -> None:
        """Delete the refit rows no MU or undo step refers to any more."""
        refs = [*self.rows, *(undo.row for undo in self.undo_stack)]
        used = {ref[0] for ref in refs if ref is not None}
        for key in [k for k in self.arrays if k != "base" and k not in used]:
            self.store.discard(self.arrays.pop(key))

    # ── refit ───────────────────────────────────────────────────────────────

    def _refit(self, step: int, entry: dict[str, Any], mu: int) -> None:
        """Refit the MU's filter as the logged ``update_filter`` step did, in its window."""
        grid = self.mu_grid_index[mu]
        view_start = _logged_int(entry, "view_start", 0)
        view_end = _logged_int(entry, "view_end", self.total_samples)
        if view_end <= view_start:
            raise ReplayError("The step's window ends before it starts.", "view_end")
        # MUedit2 peels off the other live MUs of the grid; flagged and removed ones are left out.
        inactive = set(inactive_mus_before(self.history, step, self.mu_uids))
        peel_off_spike_times = [
            self.spike_times[i]
            for i in range(self.n_mu)
            if i != mu and i not in inactive and self.mu_grid_index[i] == grid
        ]
        emg, fsamp, discard_mask = self._grid_emg(grid)
        if view_start < 0 or view_end > emg.shape[1]:
            raise ReplayError(
                "The step's window runs past the end of the EMG recording.", "view_end"
            )
        pulse_train, updated = update_motor_unit_filter_window(
            emg,
            discard_mask,
            self.spike_times[mu],
            fsamp,
            view_start,
            view_end,
            nbextchan=self.refit_settings["nbextchan"],
            peel_off_spike_times=peel_off_spike_times if entry.get("use_peeloff") else None,
            peel_off_win=self.refit_settings["peel_off_win"],
            artifact_times=self.artifact_times[mu],
            lock_spikes=bool(entry.get("lock_spikes")),
            artifact_mask=build_manual_artifact_mask(self.artifact_regions, emg.shape[1]),
            compute_dtype=self.refit_settings["compute_dtype"],
        )
        # As MUedit2: the row is copied from the train before the discharges change.
        if pulse_train is not None:
            self._splice_row(mu, view_start, pulse_train, fsamp)
        self.spike_times[mu] = spike_array(updated)

    def _splice_row(self, mu: int, view_start: int, pulse_train: FloatArray, fsamp: float) -> None:
        """Give the MU a new row with the refit's window, less its edges, written in; none if nothing is left."""
        edge = edge_samples(fsamp)
        seg_start = view_start + edge
        seg_end = min(view_start + len(pulse_train) - edge, self.total_samples)
        if seg_end <= seg_start or len(pulse_train) <= 2 * edge:
            return
        key = f"refit-{next(self._counter)}"
        row = self.store.allocate(key, (1, self.total_samples), np.float32)
        for start in range(0, self.total_samples, _COPY_BLOCK):
            row[0, start : start + _COPY_BLOCK] = self.values(mu, start, start + _COPY_BLOCK)
        row[0, seg_start:seg_end] = pulse_train[edge : edge + (seg_end - seg_start)]
        self.arrays[key] = self.store.seal(row)
        self.rows[mu] = (key, 0)

    def prepare_grid(self, grid: int) -> None:
        """Filter one grid's EMG ahead of its first refit; call it without ``lock``."""
        if grid not in self.mu_grid_index:
            return  # no MU to refit there
        try:
            self.store.hold()  # a close meanwhile deletes the store only once this returns
        except StoreClosedError as exc:
            raise ReplayError(SESSION_EXPIRED, "token") from exc
        try:
            self._grid_emg(grid)
        finally:
            self.store.release()

    def _grid_emg(self, grid: int) -> tuple[FloatArray, float, IntArray]:
        """``(emg, fsamp, discard mask)`` of one grid, filtered as the decomposition was (cached)."""
        with self._filter_locks_guard:
            lock = self._filter_locks.setdefault(grid, threading.Lock())
        with lock:
            if self._closed:
                raise ReplayError(SESSION_EXPIRED, "token")
            if grid not in self._filtered:
                filtered = self._filter_grid(grid)
                if self._closed:  # close cleared the cache while this filtered
                    raise ReplayError(SESSION_EXPIRED, "token")
                self._filtered[grid] = filtered
            return self._filtered[grid]

    def _filter_grid(self, grid: int) -> tuple[FloatArray, float, IntArray]:
        """One grid's BIDS EMG, notched and bandpassed whole into the session store."""
        # The notch is an FFT over the whole recording, so it cannot be applied to a view: the
        # grid is filtered once, whole, the way MUedit2's session filters it before a refit.
        emg, fsamp, discard_mask = self.bids_grid(grid, self.store)
        emg_type = grid_emg_type(self.grid_names[grid] if grid < len(self.grid_names) else "")
        for row in range(emg.shape[0]):
            if self._closed:
                raise ReplayError(SESSION_EXPIRED, "token")
            emg_filter_inplace(emg[row : row + 1], fsamp, emg_type)
        return self.store.seal(emg), fsamp, discard_mask

    def close(self) -> None:
        """Delete the store; a grid being prepared stops at its next row."""
        self._closed = True
        with self.lock:
            self._filtered.clear()
            self.arrays.clear()  # the base may be mapped from the file, refit rows from the store
            self.store.close()
