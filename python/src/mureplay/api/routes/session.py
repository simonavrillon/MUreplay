"""Session lifetime endpoint."""

from __future__ import annotations

from fastapi import APIRouter, Query, Response

from mureplay.api.cache import close_session
from mureplay.api.memory import parse_session_id

router = APIRouter(prefix="/api/v1", tags=["session"])


@router.post("/session/close", status_code=204)
def close_session_endpoint(session: str = Query(...)) -> Response:
    """Drop what a closing tab held; the frontend sends it as a ``keepalive`` fetch."""
    close_session(parse_session_id(session, "session"))
    return Response(status_code=204)
