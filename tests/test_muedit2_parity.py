"""Cross-repo parity: what a replay recomputes must match MUedit2's own code exactly."""

from __future__ import annotations

# MUedit2 is the reference; MUreplay mirrors the part a replay recomputes (the update_filter
# refit and the session filtering it runs on). Both packages are imported side by side, so a
# change in either that breaks the mirror fails here. MUedit2 is the sibling checkout
# ../MUedit2 (or MUEDIT2_ROOT); without it the module skips.
import importlib
import importlib.util
import json
import sys
import types
from functools import cache
from pathlib import Path
from typing import Any

import numpy as np
import pytest

from mureplay.api.services.filter_service import INTRAMUSCULAR_GRIDS, run_update_filter
from mureplay.io.loaders import load_npz_payload, load_paired_from_path
from mureplay.replay.artifact_mask import build_manual_artifact_mask
from mureplay.replay.filter_update import (
    emg_filter_inplace,
    subtract_mu_waveforms,
    update_motor_unit_filter_window,
)
from tests.conftest import MUEDIT2_ROOT, SAMPLE_ENTITY

MUEDIT2_SRC = MUEDIT2_ROOT / "python" / "src"

pytestmark = pytest.mark.skipif(
    not (MUEDIT2_SRC / "muedit" / "editing" / "operations.py").is_file(),
    reason="MUedit2 sibling checkout not present (set MUEDIT2_ROOT to locate it)",
)

FSAMP = 2000.0


@cache
def _mu2(module: str) -> Any:
    """Import a muedit module from the sibling checkout, stubbing the file readers it never needs here."""
    # MUedit2's import chain pulls in h5py (MATLAB v7.3) and xmltodict (OTB metadata),
    # which MUreplay does not install; no compared function touches either.
    for missing, attrs in (
        ("h5py", {name: type(name, (), {}) for name in ("File", "Group", "Dataset", "Reference")}),
        ("xmltodict", {"parse": lambda *_args, **_kwargs: {}}),
    ):
        if missing not in sys.modules and importlib.util.find_spec(missing) is None:
            stub = types.ModuleType(missing)
            for attr, value in attrs.items():
                setattr(stub, attr, value)
            sys.modules[missing] = stub
    src = str(MUEDIT2_SRC)
    if src not in sys.path:
        sys.path.insert(0, src)
    return importlib.import_module(module)


def _emg(seed: int) -> tuple[np.ndarray, np.ndarray, list[int]]:
    """Eight channels of noise with one MU's waveform at a dozen spikes."""
    rng = np.random.default_rng(seed)
    n = 3000
    emg = rng.normal(size=(8, n)) * 0.1
    spikes = sorted({int(v) for v in rng.integers(250, 750, 12)})
    wave = rng.normal(size=8)[:, None] * np.exp(-(np.linspace(-2, 2, 25) ** 2))[None, :]
    for s in spikes:
        if s + 25 < n:
            emg[:, s : s + 25] += wave
    return emg, np.zeros(8, dtype=int), spikes


# ── Session filtering ───────────────────────────────────────────────────────


class TestSessionFiltering:
    @pytest.mark.parametrize(("fsamp", "emg_type"), [(2000.0, 1), (10240.0, 2)])
    @pytest.mark.parametrize("n_samples", [4000, 4001])
    def test_notch_and_bandpass_match(self, fsamp: float, emg_type: int, n_samples: int) -> None:
        rng = np.random.default_rng(int(fsamp) + n_samples)
        t = np.arange(n_samples) / fsamp
        hum = np.sin(2 * np.pi * 50 * t) + np.sin(2 * np.pi * 150 * t)
        raw = rng.normal(size=(3, n_samples)) + hum
        ours = raw.astype(np.float32)
        theirs = raw.astype(np.float32)

        emg_filter_inplace(ours, fsamp, emg_type)
        _mu2("muedit.signal.filters").emg_filter_inplace(theirs, fsamp, emg_type)
        np.testing.assert_array_equal(ours, theirs)

    def test_the_intramuscular_grids_match_the_catalogue(self) -> None:
        catalogue = _mu2("muedit.signal.grid")._GRID_CATALOG
        assert set(INTRAMUSCULAR_GRIDS) == {
            k for k, spec in catalogue.items() if spec.emg_type == 2
        }


# ── Artifact mask and peel-off ──────────────────────────────────────────────


@pytest.mark.parametrize("seed", range(4))
class TestPrimitives:
    def test_artifact_masks_match(self, seed: int) -> None:
        rng = np.random.default_rng(2000 + seed)
        n = 5000
        regions = sorted({(int(rng.integers(0, n)), int(rng.integers(0, n))) for _ in range(6)})

        theirs = _mu2("muedit.decomp.preprocess").build_manual_artifact_mask(regions, n)
        ours = build_manual_artifact_mask(regions, n)
        if theirs is None or ours is None:
            assert (theirs is None) == (ours is None)
        else:
            np.testing.assert_array_equal(ours, theirs)

    def test_waveform_subtraction_matches(self, seed: int) -> None:
        rng = np.random.default_rng(seed)
        x = rng.normal(size=(6, 2000)).astype(np.float32)
        spikes = np.sort(rng.choice(np.arange(-10, 2010), 40, replace=False))
        ours, theirs = x.copy(), x.copy()

        subtract_mu_waveforms(ours, spikes, FSAMP, 0.025)
        _mu2("muedit.decomp.algorithm").subtract_mu_waveforms(theirs, spikes, FSAMP, 0.025)
        np.testing.assert_array_equal(ours, theirs)


# ── Filter update ───────────────────────────────────────────────────────────


def _compare_update(seed: int, spike_times: list[int] | None = None, **kwargs: Any) -> None:
    """Refit the same window with both codebases and require identical output."""
    emg, discard_mask, spikes = _emg(seed)
    spike_times = spikes if spike_times is None else spike_times
    args = (emg, discard_mask, spike_times, FSAMP, 0, 1000)

    pt_theirs, up_theirs = _mu2("muedit.editing.operations").update_motor_unit_filter_window(
        *args, nbextchan=1000, **kwargs
    )
    pt_ours, up_ours = update_motor_unit_filter_window(*args, nbextchan=1000, **kwargs)
    np.testing.assert_array_equal(up_ours, up_theirs)
    if pt_theirs is None or pt_ours is None:
        assert (pt_theirs is None) == (pt_ours is None)
    else:
        np.testing.assert_array_equal(pt_ours, pt_theirs)


def _mask() -> np.ndarray:
    mask = np.zeros(1000, dtype=bool)
    mask[300:420] = True
    return mask


def _locked(seed: int) -> list[int]:
    return sorted({_emg(seed)[2][0], 400, 600})


@pytest.mark.parametrize("seed", range(4))
class TestUpdateFilter:
    def test_baseline(self, seed: int) -> None:
        _compare_update(seed)

    def test_peel_off(self, seed: int) -> None:
        _compare_update(seed, peel_off_spike_times=[[300, 400, 600], [350, 500]])

    def test_artifacts(self, seed: int) -> None:
        _compare_update(seed, artifact_times=[260, 700])

    def test_lock_spikes(self, seed: int) -> None:
        _compare_update(seed, spike_times=_locked(seed), lock_spikes=True)

    def test_artifact_mask(self, seed: int) -> None:
        _compare_update(seed, artifact_mask=_mask())

    def test_mask_and_lock(self, seed: int) -> None:
        _compare_update(seed, spike_times=_locked(seed), lock_spikes=True, artifact_mask=_mask())

    def test_mask_and_peel_off(self, seed: int) -> None:
        _compare_update(seed, peel_off_spike_times=[[300, 400, 600]], artifact_mask=_mask())

    def test_fully_masked(self, seed: int) -> None:
        _compare_update(seed, artifact_mask=np.ones(1000, dtype=bool))


# ── File format ─────────────────────────────────────────────────────────────


class TestDecompositionFile:
    def test_what_muedit2_saves_loads_back(self, tmp_path: Path) -> None:
        spike_times = [[10, 20, 30], [5, 15]]
        artifact_mask = np.zeros(500, dtype=bool)
        artifact_mask[100:150] = True
        out_path = tmp_path / "sub-1_task-test_decomp.npz"
        _mu2("muedit.decomp.decomposition_file").save_decomposition_npz(
            out_path,
            pulse_trains=None,
            spike_times=spike_times,
            fsamp=2000.0,
            grid_names=["Grid A", "Grid B"],
            mu_grid_index=[0, 1],
            muscle_names=["TA"],
            parameters={"niter": 25},
            total_samples=500,
            artifact_mask=artifact_mask,
        )

        payload = load_npz_payload(out_path.read_bytes())
        assert payload["discharge_times"] == spike_times
        assert payload["grid_names"] == ["Grid A", "Grid B"]
        assert payload["mu_grid_index"] == [0, 1]
        assert payload["fsamp"] == 2000.0
        assert payload["total_samples"] == 500
        assert payload["artifact_regions"] == [[100, 150]]
        assert payload["artifact_samples"] == 50
        # No pulse trains in the file: binary trains are drawn from the spikes, as MUedit2 does.
        assert len(payload["pulse_trains"]) == 2
        for row, times in zip(payload["pulse_trains"], spike_times, strict=True):
            assert {i for i, v in enumerate(row) if v == 1.0} == set(times)


# ── End to end ──────────────────────────────────────────────────────────────


def _apply_diff(row: list[int], entry: dict[str, Any], added: str, removed: str) -> list[int]:
    """``row`` with a logged step's additions and removals applied."""
    kept = set(row) - set(entry.get(removed) or [])
    return sorted(v for v in kept | set(entry.get(added) or []) if v >= 0)


class TestSessionReplay:
    def test_replaying_the_log_reproduces_the_saved_edits(self, muedit2_session: Path) -> None:
        # From the pre-edit decomposition, every logged step is applied in order as the page
        # does: logged diffs for most, the filter engine for update_filter. Peel-off leaves
        # out the MUs flagged or removed at that step.
        log = json.loads(muedit2_session.with_suffix(".json").read_text(encoding="utf-8"))
        payload = load_paired_from_path(muedit2_session)
        run = payload["parameters"]
        mu_grid_index = payload["mu_grid_index"]
        state = [list(row) for row in payload["discharge_times"]]
        # The log lists the uids that survived; the page numbers the file's MUs as MUedit2 does.
        mu_uids = _mu2("muedit.editing.session").initial_mu_uids(mu_grid_index)
        artifacts: list[list[int]] = [[] for _ in state]
        flagged: set[int] = set()
        removed: set[int] = set()

        for entry in log["history"]:
            kind = entry["type"]
            if kind in ("remove_flagged", "remove_duplicates"):
                removed |= {mu_uids.index(uid) for uid in entry.get("removed_mu_uids") or []}
                continue
            mu = mu_uids.index(entry["mu_uid"])
            if kind == "flag_mu":
                (flagged.add if entry.get("flagged", True) else flagged.discard)(mu)
                continue
            flagged.discard(mu)  # any edit to an MU clears its flag
            if kind == "update_filter":
                grid = mu_grid_index[mu]
                resp = run_update_filter(
                    {
                        "bids_root": str(MUEDIT2_ROOT / "data" / "Test"),
                        "entity_label": SAMPLE_ENTITY,
                        "distimes": state,
                        "mu_index": mu,
                        "grid_index": grid,
                        "grid_name": payload["grid_names"][grid],
                        "view_start": entry["view_start"],
                        "view_end": entry["view_end"],
                        "use_peeloff": bool(entry.get("use_peeloff")),
                        "lock_spikes": bool(entry.get("lock_spikes")),
                        "mu_grid_index": mu_grid_index,
                        "inactive_mus": sorted(flagged | removed),
                        "artifact_times": artifacts[mu],
                        "artifact_regions": payload["artifact_regions"],
                        # MUedit2's session refits with the run's saved settings.
                        "nbextchan": run["nbextchan"],
                        "peel_off_win": run["peel_off_win"],
                        "compute_dtype": run["compute_dtype"],
                    }
                )
                state[mu] = resp["distimes"]
            else:
                state[mu] = _apply_diff(state[mu], entry, "spikes_added", "spikes_removed")
                artifacts[mu] = _apply_diff(
                    artifacts[mu], entry, "artifacts_added", "artifacts_removed"
                )

        with np.load(muedit2_session) as z:
            offsets, spikes = z["spike_offsets"], z["spike_times"]
            saved = [spikes[offsets[i] : offsets[i + 1]].tolist() for i in range(len(offsets) - 1)]
        assert [state[i] for i in range(len(state)) if i not in removed] == saved
