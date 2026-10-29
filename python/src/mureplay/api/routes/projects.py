"""Project listing endpoint."""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter

from mureplay.api.common import success_payload
from mureplay.io.projects import list_projects
from mureplay.paths import data_root

router = APIRouter(prefix="/api/v1", tags=["projects"])


@router.get("/projects")
def projects() -> dict[str, Any]:
    """The BIDS projects in the data folder, down to their trials, for the settings rail."""
    root = data_root()
    return success_payload({"projects": list_projects(root), "data_root": str(root)})
