"""Router registration for MUreplay API."""

from __future__ import annotations

from fastapi import FastAPI

from mureplay.api.routes.dialog import router as dialog_router
from mureplay.api.routes.projects import router as projects_router
from mureplay.api.routes.replay import router as replay_router
from mureplay.api.routes.series import router as series_router
from mureplay.api.routes.session import router as session_router

__all__ = ["include_routers"]


def include_routers(app: FastAPI) -> None:
    """Attach all v1 routers to the app in a single place."""
    app.include_router(replay_router)
    app.include_router(series_router)
    app.include_router(session_router)
    app.include_router(dialog_router)
    app.include_router(projects_router)
