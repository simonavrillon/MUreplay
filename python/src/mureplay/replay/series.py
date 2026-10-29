"""Viewport series, as MUedit2's ``signal/pyramid.py`` sends them: a window's samples, or its min/max per bin."""

from __future__ import annotations

from collections.abc import Callable
from dataclasses import dataclass

import numpy as np

from mureplay.models import FloatArray

#: Samples of a row reduced at once by ``envelope``.
ENVELOPE_BLOCK = 1 << 22


@dataclass
class SeriesView:
    """A viewport of a series: ``samples`` when it has no more samples than bins, else an envelope."""

    start: int
    end: int
    factor: int  # samples per bin; 1 = raw samples
    samples: FloatArray | None = None  # (rows, end - start)
    mins: FloatArray | None = None  # (rows, bins)
    maxs: FloatArray | None = None


def envelope(read: Callable[[int, int], FloatArray], start: int, end: int, bins: int) -> SeriesView:
    """``[start, end)`` of one row in ``bins`` exact bins, read ``ENVELOPE_BLOCK`` samples at a time."""
    span = end - start
    if span <= bins:
        return SeriesView(start, end, 1, samples=np.asarray(read(start, end), np.float32)[None])
    edges = start + (np.arange(bins + 1, dtype=np.int64) * span) // bins
    mins = np.empty(bins, dtype=np.float32)
    maxs = np.empty(bins, dtype=np.float32)
    first = 0
    while first < bins:
        stop = int(np.searchsorted(edges, edges[first] + ENVELOPE_BLOCK, side="right")) - 1
        stop = min(max(stop, first + 1), bins)
        block = np.asarray(read(int(edges[first]), int(edges[stop])), np.float32)
        at = edges[first:stop] - edges[first]
        mins[first:stop] = np.minimum.reduceat(block, at)
        maxs[first:stop] = np.maximum.reduceat(block, at)
        first = stop
    return SeriesView(start, end, span // bins, mins=mins[None], maxs=maxs[None])
