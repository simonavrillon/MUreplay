"""Shared response helpers for API routes."""

from __future__ import annotations

from typing import Any


def success_payload(data: Any) -> dict[str, Any]:
    """Wrap JSON success responses in the canonical v1 envelope."""
    return {"data": data, "meta": {"api_version": "v1"}}
