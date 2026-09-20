"""Replay routes: health, config, and file loading endpoints."""

from __future__ import annotations

from fastapi import APIRouter

from mureplay.api.config import DATA_ROOT
from mureplay.api.contracts import success_payload
from mureplay.api.schemas import LoadPairedFromPathPayload
from mureplay.api.services.load_service import load_from_path

router = APIRouter(prefix="/api/v1", tags=["replay"])


@router.get("/health")
async def health() -> dict:
    return success_payload({"status": "ok"})


@router.get("/config")
async def config() -> dict:
    return success_payload({"bids_root": str(DATA_ROOT)})


@router.post("/load-paired-from-path")
async def load_paired_from_path(payload: LoadPairedFromPathPayload) -> dict:
    return success_payload(load_from_path(payload.file_path))
