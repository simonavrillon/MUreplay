"""Replay operations: discharge-time normalisation and binary pulse trains."""

from __future__ import annotations

import numpy as np

from mureplay.replay.operations import build_pulse_trains_from_distimes, normalize_distimes

# ── Normalisation ───────────────────────────────────────────────────────────


class TestNormalizeDistimes:
    def test_none_is_no_rows(self) -> None:
        assert normalize_distimes(None) == []

    def test_a_flat_list_is_one_sorted_unique_non_negative_row(self) -> None:
        assert normalize_distimes([3, 1, 1, -5, 0]) == [[0, 1, 3]]

    def test_none_rows_become_empty_rows(self) -> None:
        assert normalize_distimes([[3, 1, 1, -2], None, [5]]) == [[1, 3], [], [5]]

    def test_a_scalar_row_becomes_a_one_spike_row(self) -> None:
        assert normalize_distimes([3, [1, 2]]) == [[3], [1, 2]]

    def test_numpy_arrays_of_every_shape_normalise(self) -> None:
        assert normalize_distimes(np.array([2, 2, -1, 7])) == [[2, 7]]
        assert normalize_distimes(np.array([[4, 4, -3], [1, 8, 1]])) == [[4], [1, 8]]
        assert normalize_distimes(np.array([[1, 2], [3]], dtype=object)) == [[1, 2], [3]]


# ── Pulse trains ────────────────────────────────────────────────────────────


class TestBuildPulseTrainsFromDistimes:
    def test_each_discharge_is_a_one_and_out_of_range_times_drop(self) -> None:
        pulses = build_pulse_trains_from_distimes([[2, 5, 99], []], 8)
        assert pulses.shape == (2, 8)
        assert pulses[0, 2] == 1.0
        assert pulses[0, 5] == 1.0
        assert pulses[0].sum() == 2.0
        assert not pulses[1].any()
