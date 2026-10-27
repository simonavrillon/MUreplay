"""Replay operations: discharge-time normalisation and binary pulse trains."""

from __future__ import annotations

from typing import Any

import numpy as np


def normalize_distimes(raw: Any) -> list[list[int]]:
    """Discharge times of any shape the API receives as sorted, unique, non-negative rows."""
    if raw is None:
        return []
    if isinstance(raw, np.ndarray):
        if raw.dtype == object:
            return [
                normalize_distimes(item)[0] if normalize_distimes(item) else []
                for item in raw.tolist()
            ]
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
                out.append(
                    sorted({int(v) for v in np.asarray(row).flatten().tolist() if int(v) >= 0})
                )
            else:
                try:
                    val = int(row)
                    out.append([val] if val >= 0 else [])
                except (TypeError, ValueError):
                    out.append([])
        return out
    return []


def build_pulse_trains_from_distimes(distimes: list[list[int]], total_samples: int) -> np.ndarray:
    """Binary pulse trains, 1 at each discharge, for files saved without pulse trains."""
    pulses = np.zeros((len(distimes), total_samples), dtype=float)
    for i, times in enumerate(distimes):
        if not times:
            continue
        t = np.asarray(times, dtype=int)
        t = t[(t >= 0) & (t < total_samples)]
        pulses[i, t] = 1.0
    return pulses
