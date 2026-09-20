"""Artifact-mask consumption: region parsing, rasterization, and conversion.

MUedit2 creates the mask (automatic QC detection or user-drawn regions) and
persists it inside the edited NPZ. MUreplay only consumes it: the loader
converts the stored mask into compact ``[start, end)`` regions for JSON
transport, and the filter service rasterizes regions back into a mask when
replaying ``update_filter`` steps, exactly as MUedit2's editor does.
"""

from __future__ import annotations

from typing import Any

import numpy as np


def build_manual_artifact_mask(
    artifact_regions: list[tuple[int, int]] | None,
    n_samples: int,
) -> np.ndarray | None:
    """Rasterize ``(start, end)`` sample ranges into a boolean mask."""
    if not artifact_regions or n_samples <= 0:
        return None
    mask = np.zeros(n_samples, dtype=bool)
    for start_raw, end_raw in artifact_regions:
        start, end = int(start_raw), int(end_raw)
        if end < start:
            start, end = end, start
        start = max(0, min(start, n_samples))
        end = max(0, min(end, n_samples))
        if end > start:
            mask[start:end] = True
    return mask if mask.any() else None


def mask_to_regions(mask: np.ndarray | None) -> list[list[int]]:
    """Convert a boolean sample mask into contiguous ``[start, end)`` ranges."""
    if mask is None or not mask.any():
        return []
    diff = np.diff(mask.astype(np.int8), prepend=0, append=0)
    starts = np.flatnonzero(diff == 1)
    ends = np.flatnonzero(diff == -1)
    return [[int(s), int(e)] for s, e in zip(starts, ends, strict=True)]


def parse_artifact_regions(raw: Any) -> list[tuple[int, int]]:
    """Normalize payload artifact regions (``[s, e]`` pairs or ``{start, end}`` dicts)."""
    regions: list[tuple[int, int]] = []
    for row in raw or []:
        pair: tuple[Any, Any] | None = None
        if isinstance(row, (list, tuple)) and len(row) == 2:
            pair = (row[0], row[1])
        elif isinstance(row, dict) and "start" in row and "end" in row:
            pair = (row["start"], row["end"])
        if pair is None:
            continue
        try:
            regions.append((int(pair[0]), int(pair[1])))
        except (TypeError, ValueError):
            continue
    return regions
