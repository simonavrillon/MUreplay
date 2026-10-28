"""Editing route: replay a logged ``update_filter`` step; the page replays every other step from its logged diff."""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter

from mureplay.api.common import success_payload
from mureplay.api.schemas import UpdateFilterPayload
from mureplay.api.services.filter_service import run_update_filter

router = APIRouter(prefix="/api/v1", tags=["editing"])


@router.post("/edit/update-filter")
def update_filter(payload: UpdateFilterPayload) -> dict[str, Any]:
    """Refit one MU's filter on the BIDS EMG in the logged window and return its discharges."""
    return success_payload(run_update_filter(payload))
