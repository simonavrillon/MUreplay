"""Where MUreplay finds the frontend it serves and the BIDS dataset it falls back to."""

from __future__ import annotations

import os
from pathlib import Path

#: The repository checkout this package runs from, when it is not installed.
_CHECKOUT = Path(__file__).resolve().parents[3]
DATA_ROOT_ENV = "MUREPLAY_DATA_ROOT"


def _repo_root() -> Path | None:
    """The repository checkout this package runs from, or None when it is installed."""
    return _CHECKOUT if (_CHECKOUT / "pyproject.toml").is_file() else None


def frontend_dir() -> Path | None:
    """The checkout's frontend, or None when the package is installed without it."""
    root = _repo_root()
    folder = root / "frontend" if root is not None else None
    return folder if folder is not None and (folder / "index.html").is_file() else None


def data_root() -> Path:
    """``MUREPLAY_DATA_ROOT``, else the checkout's data/, else the working directory."""
    override = os.environ.get(DATA_ROOT_ENV, "").strip()
    if override:
        return Path(override)
    root = _repo_root()
    return root / "data" if root is not None else Path.cwd()
