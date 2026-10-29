"""Array aliases shared by the packages, and what an array costs the heap."""

from __future__ import annotations

import mmap
from typing import Any, TypeAlias

import numpy as np
from numpy.typing import NDArray

FloatArray: TypeAlias = NDArray[np.floating[Any]]
IntArray: TypeAlias = NDArray[np.integer[Any]]


def resident_nbytes(arr: np.ndarray) -> int:
    """Heap bytes ``arr`` holds: 0 for a view of a memory-mapped file, whose pages the OS manages."""
    base: Any = arr
    while isinstance(base, np.ndarray):
        base = base.base
    return 0 if isinstance(base, mmap.mmap) else int(arr.nbytes)
