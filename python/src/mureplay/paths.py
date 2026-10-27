"""Where MUreplay finds the frontend it serves."""

from __future__ import annotations

from pathlib import Path

#: The repository checkout this package runs from, when it is not installed.
_CHECKOUT = Path(__file__).resolve().parents[3]


def repo_root() -> Path | None:
    """The repository checkout this package runs from, or None when it is installed."""
    return _CHECKOUT if (_CHECKOUT / "pyproject.toml").is_file() else None


def frontend_dir() -> Path | None:
    """The checkout's frontend, or None when the package is installed without it."""
    root = repo_root()
    folder = root / "frontend" if root is not None else None
    return folder if folder is not None and (folder / "index.html").is_file() else None
