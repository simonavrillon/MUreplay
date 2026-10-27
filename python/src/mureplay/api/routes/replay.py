"""Replay routes: health, config, and file loading endpoints."""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter

from mureplay.api.common import success_payload
from mureplay.api.config import DATA_ROOT
from mureplay.api.schemas import LoadPairedFromPathPayload
from mureplay.api.services.load_service import load_from_path

router = APIRouter(prefix="/api/v1", tags=["replay"])


@router.get("/health")
def health() -> dict[str, Any]:
    """Answer while the server is up."""
    return success_payload({"status": "ok"})


@router.get("/config")
def config() -> dict[str, Any]:
    """The data root the page falls back to for BIDS datasets."""
    return success_payload({"bids_root": str(DATA_ROOT)})


@router.post("/load-paired-from-path")
def load_paired_from_path(payload: LoadPairedFromPathPayload) -> dict[str, Any]:
    """Load the decomposition and edit log paired with the chosen file."""
    return success_payload(load_from_path(payload.file_path))
