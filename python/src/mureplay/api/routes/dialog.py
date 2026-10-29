"""Native OS dialog endpoints."""

from __future__ import annotations

import subprocess
from typing import Any

from fastapi import APIRouter, HTTPException

from mureplay.api.common import success_payload
from mureplay.api.services.dialog_service import choose_data_folder

router = APIRouter(prefix="/api/v1/dialog", tags=["dialog"])


@router.post("/data-folder")
def data_folder_dialog() -> dict[str, Any]:
    """Make the folder picked in a native dialog the data folder; ``None`` when cancelled."""
    try:
        folder = choose_data_folder()
    except subprocess.TimeoutExpired:
        raise HTTPException(status_code=408, detail="Folder dialog timed out") from None
    return success_payload({"data_root": str(folder) if folder is not None else None})
