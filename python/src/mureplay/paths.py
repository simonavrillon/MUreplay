"""Where MUreplay finds the frontend it serves, its config and cache folders, and the BIDS data folder."""

from __future__ import annotations

import json
import os
import sys
from pathlib import Path

#: The repository checkout this package runs from, when it is not installed.
_CHECKOUT = Path(__file__).resolve().parents[3]
DATA_ROOT_ENV = "MUREPLAY_DATA_ROOT"
CACHE_DIR_ENV = "MUREPLAY_CACHE_DIR"


def _repo_root() -> Path | None:
    """The repository checkout this package runs from, or None when it is installed."""
    return _CHECKOUT if (_CHECKOUT / "pyproject.toml").is_file() else None


def frontend_dir() -> Path | None:
    """The checkout's frontend, or None when the package is installed without it."""
    root = _repo_root()
    folder = root / "frontend" if root is not None else None
    return folder if folder is not None and (folder / "index.html").is_file() else None


def config_file() -> Path:
    """The per-user ``config.json``, in the platform's folder for app settings."""
    if sys.platform == "darwin":
        base = Path.home() / "Library" / "Application Support" / "MUreplay"
    elif sys.platform == "win32":
        base = Path(os.environ.get("APPDATA") or Path.home() / "AppData" / "Roaming") / "MUreplay"
    else:
        base = Path(os.environ.get("XDG_CONFIG_HOME") or Path.home() / ".config") / "mureplay"
    return base / "config.json"


def cache_dir() -> Path:
    """``MUREPLAY_CACHE_DIR``, else the platform's per-user cache folder for MUreplay."""
    override = os.environ.get(CACHE_DIR_ENV, "").strip()
    if override:
        return Path(override)
    if sys.platform == "darwin":
        folder = Path.home() / "Library" / "Caches" / "MUreplay"
    elif sys.platform == "win32":
        local = os.environ.get("LOCALAPPDATA") or Path.home() / "AppData" / "Local"
        folder = Path(local) / "MUreplay" / "Cache"
    else:
        folder = Path(os.environ.get("XDG_CACHE_HOME") or Path.home() / ".cache") / "mureplay"
    return folder


def _read_config() -> dict[str, object]:
    """The config's settings; empty when the file is missing or unreadable."""
    try:
        config = json.loads(config_file().read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return {}
    return config if isinstance(config, dict) else {}


def save_data_root(folder: Path) -> None:
    """Remember ``folder`` as the data folder in the config, for the next launch too."""
    config = _read_config()
    config["data_root"] = str(folder)
    path = config_file()
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(config, indent=2) + "\n", encoding="utf-8")


def data_root_override() -> Path | None:
    """``MUREPLAY_DATA_ROOT``, which fixes the data folder while it is set; None when unset."""
    override = os.environ.get(DATA_ROOT_ENV, "").strip()
    return Path(override) if override else None


def data_root() -> Path:
    """``MUREPLAY_DATA_ROOT``, else the config's folder, else the checkout's data/, else cwd."""
    override = data_root_override()
    if override is not None:
        return override
    saved = _read_config().get("data_root")
    if isinstance(saved, str) and saved:
        return Path(saved)
    root = _repo_root()
    return root / "data" if root is not None else Path.cwd()
