"""Replay endpoints: the server-side replay session, opened from a chosen file and seeked step by step."""

from __future__ import annotations

from fastapi import APIRouter, Depends
from fastapi.responses import Response

from mureplay.api.common import request_session
from mureplay.api.schemas import ReplayOpenPayload, ReplayPrepareGridPayload, ReplaySeekPayload
from mureplay.api.services.replay_service import (
    open_replay_session,
    prepare_replay_grid,
    seek_replay,
)

router = APIRouter(prefix="/api/v1", tags=["replay"], dependencies=[Depends(request_session)])


@router.post("/replay/session/open")
def open_session_endpoint(
    payload: ReplayOpenPayload, session: str = Depends(request_session)
) -> Response:
    """Open the decomposition and edit log paired with the chosen file (MUB1: its fields, then CSR discharge times)."""
    return open_replay_session(payload.file_path, session)


@router.post("/replay/seek")
def seek_endpoint(payload: ReplaySeekPayload, session: str = Depends(request_session)) -> Response:
    """Apply and undo steps until the replay holds the ones named (MUB1: what changed)."""
    return seek_replay(payload, session)


@router.post("/replay/session/prepare-grid", status_code=204)
def prepare_grid_endpoint(
    payload: ReplayPrepareGridPayload, session: str = Depends(request_session)
) -> Response:
    """Filter a grid's EMG ahead of its first refit; answers once it is done."""
    prepare_replay_grid(payload, session)
    return Response(status_code=204)
