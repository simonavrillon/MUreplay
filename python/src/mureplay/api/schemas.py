"""Pydantic request schemas for the MUreplay API: one model per POST body."""

from __future__ import annotations

from pydantic import BaseModel


class ReplayOpenPayload(BaseModel):
    """The decomposition or edit log the user chose."""

    file_path: str


class ReplaySeekPayload(BaseModel):
    """The steps of the edit log the replay should have applied, in order."""

    token: str
    steps: list[int]


class ReplayPrepareGridPayload(BaseModel):
    """The grid whose EMG to filter ahead of its first refit."""

    token: str
    grid: int
