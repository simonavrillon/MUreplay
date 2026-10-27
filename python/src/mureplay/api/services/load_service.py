"""Load service: paired decomp resolution."""

from __future__ import annotations

from pathlib import Path
from typing import Any

from mureplay.io.loaders import load_paired_from_path


def load_from_path(file_path: str) -> dict[str, Any]:
    """Resolve and load a paired decomp/log set from a selected file path."""
    return load_paired_from_path(Path(file_path.strip()))
