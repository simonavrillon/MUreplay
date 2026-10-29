"""MUedit2's ``.npz`` archives, read without running pickled code, their large members memory-mapped."""

from __future__ import annotations

import pickle
import struct
import zipfile
from dataclasses import dataclass
from pathlib import Path
from types import TracebackType
from typing import IO, Any

import numpy as np
from numpy.lib import format as npy_format

_LOCAL_HEADER = struct.Struct("<4s5H3L2H")

# Every global a MUedit2 ``.npz`` pickle references: arrays, dtypes and numpy scalars.
_LEGACY_GLOBALS: dict[tuple[str, str], tuple[str, str]] = {
    ("numpy", "ndarray"): ("numpy", "ndarray"),
    ("numpy", "dtype"): ("numpy", "dtype"),
    ("numpy._core.multiarray", "_reconstruct"): ("numpy._core.multiarray", "_reconstruct"),
    ("numpy.core.multiarray", "_reconstruct"): ("numpy._core.multiarray", "_reconstruct"),
    ("numpy._core.multiarray", "scalar"): ("numpy._core.multiarray", "scalar"),
    ("numpy.core.multiarray", "scalar"): ("numpy._core.multiarray", "scalar"),
}


class LegacyPickleError(pickle.UnpicklingError):
    """A legacy ``.npz`` pickle asks for something other than arrays, lists, dicts and numbers."""


class _LegacyUnpickler(pickle.Unpickler):
    """Rebuilds ndarrays, dtypes, numpy scalars and plain Python values, and nothing else."""

    def find_class(self, module: str, name: str) -> Any:
        target = _LEGACY_GLOBALS.get((module, name))
        if target is None:
            raise LegacyPickleError(
                f"refusing to load {module}.{name}: MUedit2 files only hold arrays, "
                "lists, dicts, strings and numbers"
            )
        return super().find_class(*target)


@dataclass(frozen=True)
class ArrayInfo:
    """What a member's ``.npy`` header says."""

    shape: tuple[int, ...]
    fortran_order: bool
    dtype: np.dtype[Any]

    @property
    def stored_shape(self) -> tuple[int, ...]:
        """Shape of the bytes read as a C-order array (the array itself, or its transpose)."""
        return self.shape[::-1] if self.fortran_order else self.shape


def _read_info(fp: IO[bytes]) -> ArrayInfo:
    version = npy_format.read_magic(fp)
    if version == (1, 0):
        shape, fortran, dtype = npy_format.read_array_header_1_0(fp)
    elif version == (2, 0):
        shape, fortran, dtype = npy_format.read_array_header_2_0(fp)
    else:
        raise ValueError(f"unsupported .npy format version {version}")
    return ArrayInfo(tuple(int(s) for s in shape), bool(fortran), np.dtype(dtype))


def _read_exact(fp: IO[bytes], out: np.ndarray) -> None:
    view = memoryview(out.reshape(-1)).cast("B")
    filled = 0
    while filled < len(view):
        n = fp.readinto(view[filled:])  # type: ignore[attr-defined]
        if not n:
            raise ValueError("truncated array data")
        filled += n


def _read_body(fp: IO[bytes], info: ArrayInfo) -> np.ndarray:
    """The array whose header ``fp`` just passed."""
    if info.dtype.hasobject:
        arr = _LegacyUnpickler(fp, encoding="ASCII").load()
        if not isinstance(arr, np.ndarray):
            raise ValueError("object member does not hold an array")
        return arr
    stored = np.empty(info.stored_shape, dtype=info.dtype)
    _read_exact(fp, stored)
    return stored.T if info.fortran_order else stored


class NpzArchive:
    """Read-only access to a ``.npz`` file, opened once; object arrays never run pickled code."""

    def __init__(self, path: str | Path) -> None:
        self.path = str(path)
        self._zip = zipfile.ZipFile(self.path)
        self._members = {
            name[: -len(".npy")]: name for name in self._zip.namelist() if name.endswith(".npy")
        }

    def __enter__(self) -> NpzArchive:
        return self

    def __exit__(
        self,
        exc_type: type[BaseException] | None,
        exc: BaseException | None,
        tb: TracebackType | None,
    ) -> None:
        self.close()

    def close(self) -> None:
        self._zip.close()

    def __contains__(self, key: object) -> bool:
        return key in self._members

    def get(self, key: str) -> np.ndarray | None:
        """The array stored under ``key``, or None when the archive has no such member."""
        if key not in self._members:
            return None
        with self._zip.open(self._members[key]) as fp:
            return _read_body(fp, _read_info(fp))

    def memmap(self, key: str) -> np.ndarray | None:
        """A read-only memory map of an uncompressed member; None if it is compressed or pickled."""
        zinfo = self._zip.getinfo(self._members[key])
        if zinfo.compress_type != zipfile.ZIP_STORED:
            return None
        with open(self.path, "rb") as fp:
            fp.seek(zinfo.header_offset)
            fields = _LOCAL_HEADER.unpack(fp.read(_LOCAL_HEADER.size))
            name_len, extra_len = fields[-2], fields[-1]
            fp.seek(zinfo.header_offset + _LOCAL_HEADER.size + name_len + extra_len)
            info = _read_info(fp)
            data_offset = fp.tell()
        if info.dtype.hasobject:
            return None
        if 0 in info.shape:
            return np.empty(info.shape, dtype=info.dtype)
        return np.memmap(
            self.path,
            dtype=info.dtype,
            mode="r",
            offset=data_offset,
            shape=info.shape,
            order="F" if info.fortran_order else "C",
        )
