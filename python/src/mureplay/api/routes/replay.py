"""Replay route: loading a session."""

from __future__ import annotations

from pathlib import Path
from typing import Any

from fastapi import APIRouter

from mureplay.api.common import success_payload
from mureplay.api.schemas import LoadPairedFromPathPayload
from mureplay.io import loaders

router = APIRouter(prefix="/api/v1", tags=["replay"])


@router.post("/load-paired-from-path")
def load_paired_from_path(payload: LoadPairedFromPathPayload) -> dict[str, Any]:
    """Load the decomposition and edit log paired with the chosen file."""
    return success_payload(loaders.load_paired_from_path(Path(payload.file_path)))
