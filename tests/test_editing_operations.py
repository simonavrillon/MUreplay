"""Replay operations: discharge-time normalisation and binary pulse trains."""

from __future__ import annotations

import numpy as np

from mureplay.replay.operations import build_pulse_trains_from_distimes, normalize_distimes

# ── Pure operations ─────────────────────────────────────────────────────────


def test_normalize_distimes_none() -> None:
    assert normalize_distimes(None) == []


def test_normalize_distimes_flat_list_dedups_sorts_drops_negatives() -> None:
    assert normalize_distimes([3, 1, 1, -5, 0]) == [[0, 1, 3]]


def test_normalize_distimes_2d_list_with_none_rows() -> None:
    assert normalize_distimes([[3, 1, 1, -2], None, [5]]) == [[1, 3], [], [5]]


def test_normalize_distimes_scalar_rows() -> None:
    assert normalize_distimes([3, [1, 2]]) == [[3], [1, 2]]


def test_normalize_distimes_numpy_arrays() -> None:
    flat = np.array([2, 2, -1, 7])
    assert normalize_distimes(flat) == [[2, 7]]
    two_d = np.array([[4, 4, -3], [1, 8, 1]])
    assert normalize_distimes(two_d) == [[4], [1, 8]]
    obj = np.array([[1, 2], [3]], dtype=object)
    assert normalize_distimes(obj) == [[1, 2], [3]]


def test_build_pulse_trains_from_distimes() -> None:
    pulses = build_pulse_trains_from_distimes([[2, 5, 99], []], 8)
    assert pulses.shape == (2, 8)
    assert pulses[0, 2] == 1.0
    assert pulses[0, 5] == 1.0
    assert pulses[0].sum() == 2.0  # out-of-range time 99 is dropped
    assert not pulses[1].any()
