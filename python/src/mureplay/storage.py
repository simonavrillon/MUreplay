"""Session stores: the full-length arrays of an open replay as memory-mapped ``.npy`` files."""

from __future__ import annotations

import contextlib
import json
import logging
import os
import shutil
import sys
import threading
import uuid
from pathlib import Path
from typing import Protocol

import numpy as np
from numpy.typing import DTypeLike

from mureplay.paths import cache_dir

logger = logging.getLogger(__name__)

MIB = 1024 * 1024
DISK_RESERVE_ENV = "MUREPLAY_DISK_RESERVE_MB"
#: Free disk a store leaves untouched; an array that would cut into it is kept in RAM instead.
DISK_RESERVE_BYTES = 1024 * MIB
_OWNER_FILE = "owner.json"


def sessions_dir() -> Path:
    """Folder holding one sub-folder per open store."""
    return cache_dir() / "sessions"


def disk_reserve_bytes() -> int:
    """``DISK_RESERVE_BYTES``, or ``MUREPLAY_DISK_RESERVE_MB`` when it is set."""
    override = os.environ.get(DISK_RESERVE_ENV, "").strip()
    return int(float(override) * MIB) if override else DISK_RESERVE_BYTES


class StoreClosedError(RuntimeError):
    """A ``hold`` on a store whose ``close`` was already asked for."""


class ArrayStore(Protocol):
    """Where a reader or a refit puts its full-length arrays."""

    def allocate(
        self, name: str, shape: tuple[int, ...], dtype: DTypeLike, *, zero: bool = False
    ) -> np.ndarray: ...

    # Read-only from a SessionStore, ``arr`` itself (writable) from a RamStore. The caller
    # drops ``arr`` afterwards: on Windows its writable map keeps the file from being deleted.
    def seal(self, arr: np.ndarray) -> np.ndarray: ...

    def discard(self, arr: np.ndarray) -> None: ...


class RamStore:
    """Arrays on the heap: what readers use when no session store is given."""

    def allocate(
        self, name: str, shape: tuple[int, ...], dtype: DTypeLike, *, zero: bool = False
    ) -> np.ndarray:
        """A new heap array; ``name`` is ignored."""
        return np.zeros(shape, dtype) if zero else np.empty(shape, dtype)

    def seal(self, arr: np.ndarray) -> np.ndarray:
        """``arr`` itself: heap arrays stay writable."""
        return arr

    def discard(self, arr: np.ndarray) -> None:
        """Nothing to delete on the heap."""


class SessionStore:
    """A folder of ``.npy`` files under ``sessions_dir()``, deleted by ``close``."""

    def __init__(self, path: Path) -> None:
        self.path = path
        self._warned_full = False
        self._lock = threading.Lock()
        self._holds = 0
        self._closing = False  # ``close`` was asked for; it runs once the last hold is released

    @classmethod
    def create(cls, label: str) -> SessionStore:
        """A new, empty store folder owned by this process."""
        root = sessions_dir()
        root.mkdir(parents=True, exist_ok=True)
        path = root / f"{label}-{uuid.uuid4().hex[:12]}"
        path.mkdir()
        (path / _OWNER_FILE).write_text(json.dumps({"pid": os.getpid()}), encoding="utf-8")
        return cls(path)

    def _new_file(self, name: str) -> Path:
        """``<name>.npy``, or a suffixed name if that file exists (a live map must not be truncated)."""
        path = self.path / f"{name}.npy"
        if path.exists():
            path = self.path / f"{name}-{uuid.uuid4().hex[:8]}.npy"
        return path

    def _fits_on_disk(self, nbytes: int) -> bool:
        try:
            free = shutil.disk_usage(self.path).free
        except OSError:
            return False
        if free - nbytes >= disk_reserve_bytes():
            return True
        if not self._warned_full:
            logger.warning(
                "Keeping arrays in RAM: %.0f MB free in %s, %.0f MB needed plus a %.0f MB reserve",
                free / MIB,
                self.path,
                nbytes / MIB,
                disk_reserve_bytes() / MIB,
            )
            self._warned_full = True
        return False

    def allocate(
        self, name: str, shape: tuple[int, ...], dtype: DTypeLike, *, zero: bool = False
    ) -> np.ndarray:
        """A writable array backed by a new ``<name>.npy`` (zero-filled), or on the heap if the disk is full."""
        dt = np.dtype(dtype)
        dims = tuple(int(s) for s in shape)
        nbytes = int(np.prod(dims, dtype=np.int64)) * dt.itemsize
        if nbytes == 0 or not self._fits_on_disk(nbytes):
            return RamStore().allocate(name, dims, dt, zero=zero)
        return np.lib.format.open_memmap(self._new_file(name), mode="w+", dtype=dt, shape=dims)

    def seal(self, arr: np.ndarray) -> np.ndarray:
        """Flush a stored array and reopen it read-only; a heap fallback becomes a read-only view."""
        if isinstance(arr, np.memmap) and arr.filename:
            arr.flush()
            return np.load(arr.filename, mmap_mode="r")
        view = arr.view()
        view.flags.writeable = False
        return view

    def discard(self, arr: np.ndarray) -> None:
        """Delete the file behind ``arr`` if this store owns it; live maps keep their pages."""
        filename = getattr(arr, "filename", None)
        if not filename or Path(filename).resolve().parent != self.path.resolve():
            return
        # Windows cannot delete a mapped file: it goes when the store closes.
        with contextlib.suppress(OSError):
            Path(filename).unlink(missing_ok=True)

    def hold(self) -> None:
        """Keep the folder while another process reads it: ``close`` waits for ``release``."""
        # ``close`` deletes outside the lock, so no hold may start once it was asked for.
        with self._lock:
            if self._closing:
                raise StoreClosedError(f"Session store {self.path.name} is closed")
            self._holds += 1

    def release(self) -> None:
        """End one ``hold``, and do a ``close`` that was asked for meanwhile."""
        with self._lock:
            if self._holds == 0:
                logger.warning("Session store %s released more often than held", self.path.name)
                return
            self._holds -= 1
            close = self._holds == 0 and self._closing
        if close:
            self.close()

    def close(self) -> None:
        """Delete the folder now, or once the last ``hold`` is released."""
        with self._lock:
            self._closing = True
            if self._holds:
                return
        # What Windows still maps is left for the next purge_stale_sessions.
        shutil.rmtree(self.path, ignore_errors=True)


def _pid_alive(pid: int) -> bool:
    """Whether a process with this id is running."""
    alive = False
    if sys.platform == "win32":
        import ctypes

        still_active = 259
        handle = ctypes.windll.kernel32.OpenProcess(0x1000, False, pid)
        if handle:
            code = ctypes.c_ulong()
            ok = ctypes.windll.kernel32.GetExitCodeProcess(handle, ctypes.byref(code))
            ctypes.windll.kernel32.CloseHandle(handle)
            alive = bool(ok) and code.value == still_active
    else:
        try:
            os.kill(pid, 0)
            alive = True
        except PermissionError:
            alive = True
        except OSError:
            alive = False
    return alive


def _owner_pid(folder: Path) -> int | None:
    try:
        return int(json.loads((folder / _OWNER_FILE).read_text(encoding="utf-8"))["pid"])
    except (OSError, ValueError, KeyError, TypeError):
        return None


def purge_stale_sessions() -> None:
    """Delete store folders whose owning process has exited (or that name no owner)."""
    root = sessions_dir()
    if not root.is_dir():
        return
    for folder in root.iterdir():
        if not folder.is_dir():
            continue
        pid = _owner_pid(folder)
        if pid is None or not _pid_alive(pid):
            logger.info("Removing stale session store %s", folder)
            shutil.rmtree(folder, ignore_errors=True)
