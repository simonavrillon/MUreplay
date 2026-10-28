"""Native OS dialog endpoints."""

from __future__ import annotations

import subprocess
from typing import Any

from fastapi import APIRouter, HTTPException

from mureplay.api.common import success_payload
from mureplay.api.services.dialog_service import choose_file

router = APIRouter(prefix="/api/v1/dialog", tags=["dialog"])


@router.get("/open-file")
def open_file_dialog() -> dict[str, Any]:
    """Return the path picked in a native open dialog, or ``None`` when cancelled."""
    try:
        path = choose_file()
    except subprocess.TimeoutExpired:
        raise HTTPException(status_code=408, detail="File dialog timed out") from None
    return success_payload({"path": path})
