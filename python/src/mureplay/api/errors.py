"""Shared exception payload and handlers for MUreplay API."""

from __future__ import annotations

from typing import Any

from fastapi import FastAPI, Request
from fastapi.encoders import jsonable_encoder
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from starlette.exceptions import HTTPException


def error_payload(code: str, message: str, detail: Any = None) -> dict[str, Any]:
    """Build canonical API error envelope."""
    payload: dict[str, Any] = {"error": {"code": code, "message": message}}
    if detail is not None:
        payload["error"]["detail"] = detail
    return payload


async def http_exception_handler(_: Request, exc: Exception) -> JSONResponse:
    """Translate HTTPException into the envelope."""
    if not isinstance(exc, HTTPException):
        return await unhandled_exception_handler(_, exc)
    detail: Any = exc.detail
    message = detail if isinstance(detail, str) else "Request failed"
    return JSONResponse(
        status_code=exc.status_code,
        content=error_payload(
            code=f"http_{exc.status_code}",
            message=message,
            detail=detail if not isinstance(detail, str) else None,
        ),
        headers=getattr(exc, "headers", None),
    )


async def validation_exception_handler(_: Request, exc: Exception) -> JSONResponse:
    """Translate request model validation failures into project envelope."""
    if not isinstance(exc, RequestValidationError):
        return await unhandled_exception_handler(_, exc)
    return JSONResponse(
        status_code=422,
        content=error_payload(
            code="validation_error",
            message="Request validation failed",
            detail=jsonable_encoder(exc.errors()),
        ),
    )


async def not_found_exception_handler(_: Request, exc: Exception) -> JSONResponse:
    """Report a missing decomposition, sidecar, or BIDS file as a 404.

    The loaders name the file and the folder they searched, which is the whole
    answer for the user, so the message is passed through rather than replaced
    by the catch-all's "Internal server error".
    """
    return JSONResponse(
        status_code=404,
        content=error_payload(code="not_found", message=str(exc)),
    )


async def value_error_handler(_: Request, exc: Exception) -> JSONResponse:
    """Report a rejected request payload as a 400, keeping the reason."""
    return JSONResponse(
        status_code=400,
        content=error_payload(code="bad_request", message=str(exc)),
    )


async def runtime_error_handler(_: Request, exc: Exception) -> JSONResponse:
    """Report an environment failure (missing pyedflib, dialog crash) as a 500.

    Still a server fault, but the message says which dependency or subprocess
    failed, which the user can act on.
    """
    return JSONResponse(
        status_code=500,
        content=error_payload(code="internal_error", message=str(exc)),
    )


async def unhandled_exception_handler(_: Request, exc: Exception) -> JSONResponse:
    """Catch-all error handler to avoid leaking internal tracebacks to clients."""
    return JSONResponse(
        status_code=500,
        content=error_payload(
            code="internal_error",
            message="Internal server error",
            detail={"type": exc.__class__.__name__},
        ),
    )


def register_exception_handlers(app: FastAPI) -> None:
    """Register all API exception handlers on the FastAPI app instance.

    Starlette resolves a handler by walking the raised type's MRO, so the
    specific domain errors below are matched ahead of the ``Exception``
    catch-all. Every ``raise`` in the loaders and services carries a message
    written for the user; without these three the catch-all swallowed all of
    them and the UI could only show "Internal server error".
    """
    app.add_exception_handler(HTTPException, http_exception_handler)
    app.add_exception_handler(RequestValidationError, validation_exception_handler)
    app.add_exception_handler(FileNotFoundError, not_found_exception_handler)
    app.add_exception_handler(ValueError, value_error_handler)
    app.add_exception_handler(RuntimeError, runtime_error_handler)
    app.add_exception_handler(Exception, unhandled_exception_handler)
