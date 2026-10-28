"""Shared exception payload and handlers for MUreplay API."""

from __future__ import annotations

import logging
from typing import Any

from fastapi import FastAPI, Request
from fastapi.encoders import jsonable_encoder
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from starlette.exceptions import HTTPException

from mureplay.errors import MureplayError

logger = logging.getLogger(__name__)


def _error_payload(code: str, message: str, detail: Any = None) -> dict[str, Any]:
    """Build canonical API error envelope."""
    payload: dict[str, Any] = {"error": {"code": code, "message": message}}
    if detail is not None:
        payload["error"]["detail"] = detail
    return payload


async def _http_exception_handler(request: Request, exc: Exception) -> JSONResponse:
    """Translate HTTPException (FastAPI's or Starlette's routing 404/405) into the envelope."""
    if not isinstance(exc, HTTPException):
        return await _unhandled_exception_handler(request, exc)
    # Starlette fills a missing detail with the status phrase; domain errors are MureplayErrors.
    return JSONResponse(
        status_code=exc.status_code,
        content=_error_payload(code=f"http_{exc.status_code}", message=exc.detail),
        headers=getattr(exc, "headers", None),
    )


async def _validation_exception_handler(request: Request, exc: Exception) -> JSONResponse:
    """Translate request model validation failures into project envelope."""
    if not isinstance(exc, RequestValidationError):
        return await _unhandled_exception_handler(request, exc)
    return JSONResponse(
        status_code=422,
        content=_error_payload(
            code="validation_error",
            message="Request validation failed",
            detail=jsonable_encoder(exc.errors()),  # ``input`` can be raw body bytes
        ),
    )


async def _mureplay_exception_handler(request: Request, exc: Exception) -> JSONResponse:
    """Translate an error the user can fix into its status, with the error's own message."""
    if not isinstance(exc, MureplayError):
        return await _unhandled_exception_handler(request, exc)
    logger.info("%s %s: %d %s", request.method, request.url.path, exc.status, exc)
    return JSONResponse(
        status_code=exc.status,
        content=_error_payload(
            code=f"http_{exc.status}",
            message=str(exc),
            detail={"field": exc.field} if exc.field else None,
        ),
    )


async def _unhandled_exception_handler(request: Request, exc: Exception) -> JSONResponse:
    """Log the traceback; the client gets a generic 500."""
    logger.error("Unhandled error on %s %s", request.method, request.url.path, exc_info=exc)
    return JSONResponse(
        status_code=500,
        content=_error_payload(code="internal_error", message="Internal server error"),
    )


def register_exception_handlers(app: FastAPI) -> None:
    """Register all API exception handlers on the FastAPI app instance."""
    app.add_exception_handler(HTTPException, _http_exception_handler)
    app.add_exception_handler(RequestValidationError, _validation_exception_handler)
    app.add_exception_handler(MureplayError, _mureplay_exception_handler)
    app.add_exception_handler(Exception, _unhandled_exception_handler)
