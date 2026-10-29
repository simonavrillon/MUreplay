"""Viewport series endpoint: the pulse train the replay draws, at the resolution drawn."""

from __future__ import annotations

from fastapi import APIRouter, Depends, Query
from fastapi.responses import Response

from mureplay.api.common import request_session
from mureplay.api.services.series_service import MAX_BINS, pulse_frame

router = APIRouter(prefix="/api/v1", tags=["series"], dependencies=[Depends(request_session)])

_BINS = Query(1024, ge=1, le=MAX_BINS, description="Bins of the envelope (about the pixel width)")
_START = Query(0, ge=0)
_END = Query(0, ge=0, description="Exclusive end sample; 0 is the end of the recording")


@router.get("/series/pulse")
def series_pulse(
    token: str,
    mu: int,
    start: int = _START,
    end: int = _END,
    bins: int = _BINS,
) -> Response:
    """One MU's pulse train envelope (MUB1) with its discharges and artifact markers."""
    return pulse_frame(token, mu, start, end, bins)
