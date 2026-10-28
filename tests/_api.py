"""Helpers for the API tests: the route prefix and the response envelopes."""

from __future__ import annotations

from typing import Any

from httpx import Response

API = "/api/v1"


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
