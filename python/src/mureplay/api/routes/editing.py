"""Editing route: replay a logged ``update_filter`` step.

The other MUedit2 edit actions (add/delete spikes, delete_dr, remove_outliers,
flag_mu) are replayed in the browser from the diffs recorded in the edit log,
so only the filter recomputation — which needs the raw BIDS EMG and scipy —
is served here.
"""

from __future__ import annotations

from fastapi import APIRouter

from mureplay.api.contracts import success_payload
from mureplay.api.schemas import UpdateFilterPayload
from mureplay.api.services.filter_service import run_update_filter

router = APIRouter(prefix="/api/v1", tags=["editing"])


@router.post("/edit/update-filter")
async def update_filter(payload: UpdateFilterPayload) -> dict:
    return success_payload(run_update_filter(payload.model_dump()))
