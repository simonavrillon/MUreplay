"""MUreplay — interactive replay tool for MUedit2 motor unit editing sessions."""

from __future__ import annotations

import importlib.metadata


def installed_version() -> str | None:
    """The installed MUreplay version, or ``None`` when the package metadata is missing."""
    try:
        return importlib.metadata.version("mureplay")
    except importlib.metadata.PackageNotFoundError:
        return None
