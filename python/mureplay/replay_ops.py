from __future__ import annotations

from typing import Any

import numpy as np
from scipy.signal import find_peaks


def normalize_distimes(raw: Any) -> list[list[int]]:
    if raw is None:
        return []
    if isinstance(raw, np.ndarray):
        if raw.dtype == object:
            return [normalize_distimes(item)[0] if normalize_distimes(item) else [] for item in raw.tolist()]
        if raw.ndim <= 1:
            vals = [int(v) for v in raw.tolist() if int(v) >= 0]
            return [sorted(set(vals))]
        return [sorted({int(v) for v in row if int(v) >= 0}) for row in raw.tolist()]
    if isinstance(raw, (list, tuple)):
        if raw and all(isinstance(x, (int, float, np.integer, np.floating)) for x in raw):
            vals = [int(v) for v in raw if int(v) >= 0]
            return [sorted(set(vals))]
        out: list[list[int]] = []
        for row in raw:
            if row is None:
                out.append([])
            elif isinstance(row, (list, tuple, np.ndarray)):
                out.append(sorted({int(v) for v in np.asarray(row).flatten().tolist() if int(v) >= 0}))
            else:
                try:
                    val = int(row)
                    out.append([val] if val >= 0 else [])
                except Exception:  # noqa: BLE001
                    out.append([])
        return out
    return []


def build_pulse_trains_from_distimes(distimes: list[list[int]], total_samples: int) -> np.ndarray:
    pulses = np.zeros((len(distimes), total_samples), dtype=float)
    for i, times in enumerate(distimes):
        if not times:
            continue
        t = np.asarray(times, dtype=int)
        t = t[(t >= 0) & (t < total_samples)]
        pulses[i, t] = 1.0
    return pulses


def add_spikes_in_roi(
    pulse: np.ndarray,
    spike_times: list[int],
    fsamp: float,
    x_start: int,
    x_end: int,
    y_min: float,
) -> list[int]:
    temp = pulse.copy()
    mask = (np.arange(len(temp)) >= x_start) & (np.arange(len(temp)) <= x_end)
    temp[~mask] = 0
    peaks, _ = find_peaks(temp, height=y_min, distance=int(round(fsamp * 0.005)))
    updated = list(spike_times) + peaks.astype(int).tolist()
    return sorted({int(x) for x in updated if int(x) >= 0})


def delete_spikes_in_roi(
    pulse: np.ndarray,
    spike_times: list[int],
    x_start: int,
    x_end: int,
    y_min: float,
    y_max: float,
) -> list[int]:
    low, high = min(y_min, y_max), max(y_min, y_max)
    updated = []
    for t in sorted(spike_times):
        if t < x_start or t > x_end:
            updated.append(int(t))
            continue
        val = pulse[t] if 0 <= t < len(pulse) else 0
        if low <= val <= high:
            continue
        updated.append(int(t))
    return sorted({int(x) for x in updated if int(x) >= 0})


def delete_high_discharge_rate_spikes_in_roi(
    pulse: np.ndarray,
    spike_times: list[int],
    fsamp: float,
    x_start: int,
    x_end: int,
    y_min: float,
) -> list[int]:
    ordered = sorted(spike_times)
    if len(ordered) < 2:
        return ordered

    dist = np.array(ordered, dtype=int)
    isi = np.diff(dist)
    valid = isi > 0
    if not np.any(valid):
        return ordered

    isi = isi[valid]
    dr = fsamp / isi
    mids = dist[1:][valid] - (isi // 2)

    deletions = set()
    for i in range(len(dr)):
        if mids[i] < x_start or mids[i] > x_end or dr[i] <= y_min:
            continue
        left = ordered[i]
        right = ordered[i + 1]
        left_val = pulse[left] if 0 <= left < len(pulse) else 0
        right_val = pulse[right] if 0 <= right < len(pulse) else 0
        deletions.add(i if left_val < right_val else i + 1)

    return sorted({int(t) for j, t in enumerate(ordered) if j not in deletions})


def remove_discharge_rate_outliers(
    pulse: np.ndarray,
    spike_times: list[int],
    fsamp: float,
    z_factor: float = 3.0,
) -> list[int]:
    ordered = sorted({int(x) for x in spike_times})
    if len(ordered) < 3:
        return ordered

    rates = []
    for i in range(len(ordered) - 1):
        isi = ordered[i + 1] - ordered[i]
        if isi > 0:
            rates.append(fsamp / isi)
    if not rates:
        return ordered

    rates_arr = np.asarray(rates, dtype=float)
    threshold = float(np.mean(rates_arr) + z_factor * np.std(rates_arr))

    deletions = set()
    for i, dr in enumerate(rates_arr):
        if dr <= threshold:
            continue
        left = ordered[i]
        right = ordered[i + 1]
        left_val = pulse[left] if 0 <= left < len(pulse) else 0
        right_val = pulse[right] if 0 <= right < len(pulse) else 0
        deletions.add(i if left_val < right_val else i + 1)
    return [t for j, t in enumerate(ordered) if j not in deletions]
