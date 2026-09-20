"""Dialog route: native OS file picker."""

from __future__ import annotations

from pathlib import Path

from fastapi import APIRouter

from mureplay.api.contracts import success_payload
from mureplay.io.dialog import open_native_dialog

router = APIRouter(prefix="/api/v1", tags=["dialog"])


@router.get("/dialog/open-file")
async def open_file() -> dict:
    path = open_native_dialog()
    if not path:
        return success_payload({"path": None, "name": None})
    return success_payload({"path": path, "name": Path(path).name})
