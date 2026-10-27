"""Central configuration for the MUreplay API."""

from __future__ import annotations

import os
from pathlib import Path

from mureplay.paths import repo_root

DATA_ROOT_ENV = "MUREPLAY_DATA_ROOT"


def default_data_root() -> Path:
    """``MUREPLAY_DATA_ROOT``, else the checkout's data/, else the working directory."""
    override = os.environ.get(DATA_ROOT_ENV, "").strip()
    if override:
        return Path(override)
    root = repo_root()
    return root / "data" if root is not None else Path.cwd()


#: Where the page looks for BIDS datasets when a file names none.
DATA_ROOT = default_data_root()
