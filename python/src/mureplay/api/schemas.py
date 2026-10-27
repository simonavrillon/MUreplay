"""Pydantic request schemas for MUreplay API.

Mirrors MUedit2's schema approach: typed models for every POST body so
FastAPI validates before the handler runs.
"""

from __future__ import annotations

from typing import Any

from pydantic import BaseModel, Field


class LoadPairedFromPathPayload(BaseModel):
    file_path: str


class UpdateFilterPayload(BaseModel):
    bids_root: str
    entity_label: str
    distimes: list[list[int]] = Field(default_factory=list)
    mu_index: int = 0
    grid_index: int = 0
    grid_name: str = ""
    view_start: int = 0
    view_end: int = 0
    nbextchan: int = 1000
    pulse_train: list[float] = Field(default_factory=list)
    use_peeloff: bool = False
    peel_off_win: float = 0.025
    mu_grid_index: list[int] = Field(default_factory=list)
    inactive_mus: list[int] = Field(default_factory=list)
    artifact_times: list[int] = Field(default_factory=list)
    lock_spikes: bool = False
    artifact_regions: list[Any] | None = None
