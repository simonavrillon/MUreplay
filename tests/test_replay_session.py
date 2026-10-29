"""The replay session: steps applied and undone on the server, refits kept in its store."""

from __future__ import annotations

from pathlib import Path
from typing import Any

import numpy as np
import pytest

from mureplay.models import FloatArray, IntArray
from mureplay.replay.session import ReplayError, ReplaySession, grid_emg_type
from mureplay.storage import SessionStore
from tests._platform import store_files

FSAMP = 2000.0
N = 4000
SPIKES = [300, 500, 700, 900, 1100, 1300, 1500]


def _emg() -> np.ndarray:
    """Eight channels of noise with one MU's waveform at ``SPIKES``."""
    rng = np.random.default_rng(0)
    emg = rng.normal(size=(8, N)) * 0.1
    wave = rng.normal(size=8)[:, None] * np.exp(-(np.linspace(-2, 2, 25) ** 2))[None, :]
    for s in SPIKES:
        emg[:, s : s + 25] += wave
    return emg


class _Grid:
    """A BIDS grid reader that counts its reads."""

    def __init__(self) -> None:
        self.reads = 0

    def __call__(self, grid: int, store: SessionStore) -> tuple[FloatArray, float, IntArray]:
        self.reads += 1
        out = store.allocate("bids-grid", (8, N), np.float32)
        out[...] = _emg()
        return out, FSAMP, np.zeros(8, dtype=int)


def _session(store: SessionStore, history: list[dict[str, Any]], **kwargs: Any) -> ReplaySession:
    return ReplaySession(
        store=store,
        total_samples=N,
        spike_times=[SPIKES, [200, 2200]],
        pulse_trains=kwargs.pop("pulse_trains", np.zeros((2, N), dtype=np.float32)),
        mu_grid_index=[0, 0],
        mu_uids=["g0_mu0", "g0_mu1"],
        grid_names=["Grid 1"],
        history=history,
        refit_settings={"nbextchan": 1000, "peel_off_win": 0.025, "compute_dtype": "float32"},
        bids_grid=kwargs.pop("bids_grid", _Grid()),
        **kwargs,
    )


@pytest.fixture
def store(cache_dir: Path) -> SessionStore:
    return SessionStore.create("replay")


REFIT = {"type": "update_filter", "mu_uid": "g0_mu0", "view_start": 0, "view_end": 2000}

# ── Opening ─────────────────────────────────────────────────────────────────


class TestOpening:
    def test_an_edited_file_is_rewound_to_where_the_edits_started(
        self, store: SessionStore
    ) -> None:
        history = [
            {"type": "add_spikes", "mu_uid": "g0_mu1", "spikes_added": [2200]},
            {"type": "add_artifact", "mu_uid": "g0_mu1", "artifacts_added": [50]},
        ]
        replay = _session(store, history, artifact_times=[[], [50]], rewind=True)
        assert replay.spike_times[1].tolist() == [200]
        assert replay.artifact_times[1].tolist() == []

    def test_a_file_without_pulse_trains_draws_them_from_its_discharges(
        self, store: SessionStore
    ) -> None:
        replay = _session(store, [], pulse_trains=None)
        assert replay.rows[1] is None
        assert np.flatnonzero(replay.values(1, 0, N)).tolist() == [200, 2200]


# ── Refits ──────────────────────────────────────────────────────────────────


class TestRefit:
    def test_a_refit_writes_a_new_row_that_seeking_back_deletes(self, store: SessionStore) -> None:
        replay = _session(store, [REFIT], bids_grid=_Grid())
        change = replay.seek([0])
        assert change.changed == [0] and change.refit_errors == []
        assert replay.rows[0] != ("base", 0)
        assert np.any(replay.values(0, 0, 2000))
        assert "refit" in store_files(store)

        replay.seek([])
        assert replay.rows[0] == ("base", 0)
        assert replay.spike_times[0].tolist() == SPIKES
        assert list(replay.arrays) == ["base"]

    def test_a_grid_is_read_and_filtered_once(self, store: SessionStore) -> None:
        grid = _Grid()
        replay = _session(
            store, [REFIT, dict(REFIT, view_start=1000, view_end=3000)], bids_grid=grid
        )
        replay.prepare_grid(0)
        replay.seek([0, 1])
        replay.seek([])
        replay.seek([0])
        assert grid.reads == 1

    def test_a_window_past_the_recording_falls_back_to_the_log(self, store: SessionStore) -> None:
        step = dict(REFIT, view_end=N + 10, spikes_added=[3000])
        replay = _session(store, [step], bids_grid=_Grid())
        change = replay.seek([0])
        assert change.refit_errors == [
            {"step": 0, "message": "The step's window runs past the end of the EMG recording."}
        ]
        assert 3000 in replay.spike_times[0].tolist()

    def test_an_unreadable_recording_falls_back_to_the_log_without_stopping_the_seek(
        self, store: SessionStore
    ) -> None:
        def unreadable(grid: int, store: SessionStore) -> tuple[FloatArray, float, IntArray]:
            raise OSError("corrupt BDF header")

        history: list[dict[str, Any]] = [
            dict(REFIT, spikes_added=[3000]),
            {"type": "add_spikes", "mu_uid": "g0_mu1", "spikes_added": [9]},
        ]
        replay = _session(store, history, bids_grid=unreadable)
        change = replay.seek([0, 1])
        assert [e["step"] for e in change.refit_errors] == [0]
        assert "corrupt" not in change.refit_errors[0]["message"]
        assert 3000 in replay.spike_times[0].tolist()
        assert replay.applied == [0, 1]

    def test_a_closed_session_refuses_to_prepare_a_grid(self, store: SessionStore) -> None:
        replay = _session(store, [REFIT], bids_grid=_Grid())
        replay.close()
        with pytest.raises(ReplayError) as refused:
            replay.prepare_grid(0)
        assert refused.value.field == "token"


class TestGridEmgType:
    @pytest.mark.parametrize(
        ("grid_name", "expected"),
        [("HD08MM1305", 1), ("Grid 3 MYOMRF-4x8", 2), ("MYOMNP-1x32", 2), ("", 1)],
    )
    def test_intramuscular_grids_take_the_wide_band(self, grid_name: str, expected: int) -> None:
        assert grid_emg_type(grid_name) == expected
