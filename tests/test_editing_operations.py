"""Editing operations: the pure spike/artifact math MUedit2 and MUreplay share.

These functions no longer back an HTTP endpoint — the browser replays the
logged diffs directly — but they stay pinned here and in
``test_muedit2_parity`` so the two codebases cannot drift apart.
"""

from __future__ import annotations

import numpy as np

from mureplay.replay.operations import (
    add_spikes_in_roi,
    build_pulse_trains_from_distimes,
    delete_artifacts_in_roi,
    delete_high_discharge_rate_spikes_in_roi,
    delete_spikes_in_roi,
    normalize_distimes,
    remove_discharge_rate_outliers,
)

FSAMP = 2000.0


def make_pulse(length: int, peaks: dict[int, float]) -> np.ndarray:
    pulse = np.zeros(length, dtype=float)
    for idx, height in peaks.items():
        pulse[idx] = height
    return pulse


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


def test_add_spikes_in_roi_picks_peaks_and_merges() -> None:
    pulse = make_pulse(100, {10: 0.5, 50: 0.8, 80: 0.9})
    out = add_spikes_in_roi(pulse, [20], FSAMP, x_start=0, x_end=60, y_min=0.3)
    assert out == [10, 20, 50]  # peak at 80 lies outside the ROI


def test_delete_spikes_in_roi_removes_amplitude_box() -> None:
    pulse = make_pulse(100, {10: 0.5, 50: 0.8, 80: 0.9})
    out = delete_spikes_in_roi(pulse, [10, 50, 80], 0, 100, y_min=0.6, y_max=1.0)
    assert out == [10]
    swapped = delete_spikes_in_roi(pulse, [10, 50, 80], 0, 100, y_min=1.0, y_max=0.6)
    assert swapped == [10]  # y_min/y_max order does not matter


def test_delete_spikes_in_roi_box_extends_one_above_y_max() -> None:
    # MUedit2 widens the box to [low, max(y_min, y_max) + 1]; a spike whose
    # amplitude falls in (y_max, y_max + 1] is deleted too.
    pulse = make_pulse(100, {10: 0.5, 50: 1.55})
    out = delete_spikes_in_roi(pulse, [10, 50], 0, 100, y_min=0.6, y_max=1.0)
    assert out == [10]


def test_delete_artifacts_in_roi_removes_amplitude_box() -> None:
    pulse = make_pulse(100, {10: 0.5, 50: 0.8, 80: 0.9})
    out = delete_artifacts_in_roi(pulse, [10, 50, 80], 0, 100, y_min=0.6, y_max=1.0)
    assert out == [10]


def test_delete_high_discharge_rate_spikes_in_roi() -> None:
    pulse = make_pulse(300, {0: 1.0, 10: 0.5, 100: 0.5, 110: 1.0, 200: 0.5})
    out = delete_high_discharge_rate_spikes_in_roi(
        pulse, [0, 10, 100, 110, 200], FSAMP, x_start=0, x_end=1000, y_min=100.0
    )
    # Pairs (0,10) and (100,110) exceed 100 pps; the lower-amplitude spike of
    # each pair is removed.
    assert out == [0, 110, 200]


def test_remove_discharge_rate_outliers() -> None:
    times = sorted(set(range(0, 2000, 100)) | {105})
    pulse = make_pulse(2000, {100: 1.0, 105: 0.5})
    out = remove_discharge_rate_outliers(pulse, times, FSAMP)
    assert out == list(range(0, 2000, 100))  # only the low-amplitude 105 outlier goes
