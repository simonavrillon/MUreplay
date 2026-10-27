"""Helpers for the API tests: the app's client and its response envelopes."""

from __future__ import annotations

from collections.abc import Iterator
from contextlib import contextmanager
from typing import Any

from httpx import Response
from starlette.testclient import TestClient

from mureplay.api.app_factory import create_app
from mureplay.api.routes import include_routers

API = "/api/v1"


@contextmanager
def api_client() -> Iterator[TestClient]:
    """The app as ``cli.serve_api`` builds it, without the page."""
    app = create_app()
    include_routers(app)
    with TestClient(app, raise_server_exceptions=False) as test_client:
        yield test_client


def ok(resp: Response) -> Any:
    """Assert a 200 success envelope and return its ``data``."""
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert set(body) == {"data", "meta"}
    assert body["meta"] == {"api_version": "v1"}
    return body["data"]


def error(resp: Response, status: int, code: str | None = None) -> dict[str, Any]:
    """Assert an error envelope with the given status and return ``error``."""
    assert resp.status_code == status, resp.text
    body = resp.json()
    assert set(body) == {"error"}
    err = body["error"]
    assert {"code", "message"} <= set(err)
    assert err["code"] == (code or f"http_{status}")
    return dict(err)
