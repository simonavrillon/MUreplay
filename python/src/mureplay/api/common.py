"""Shared response and request helpers for API routes."""

from __future__ import annotations

from typing import Any

from fastapi import Header

from mureplay.api.cache import BUDGET
from mureplay.api.memory import DEFAULT_SESSION, parse_session_id

SESSION_HEADER = "X-MUreplay-Session"


def success_payload(data: Any) -> dict[str, Any]:
    """Wrap JSON success responses in the canonical v1 envelope."""
    return {"data": data, "meta": {"api_version": "v1"}}


def request_session(x_mureplay_session: str | None = Header(None)) -> str:
    """The calling tab's session id; a request that sends one makes it the active session."""
    if x_mureplay_session is None:
        return DEFAULT_SESSION
    session = parse_session_id(x_mureplay_session, SESSION_HEADER)
    BUDGET.touch(session)
    return session
