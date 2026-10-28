"""Pydantic request schemas for the MUreplay API: one model per POST body."""

from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, Field


class LoadPairedFromPathPayload(BaseModel):
    """The decomposition or edit log the user chose."""

    file_path: str


class UpdateFilterPayload(BaseModel):
    """A logged ``update_filter`` step, with the replay state it runs on."""

    bids_root: str
    entity_label: str
    distimes: list[list[int]] = Field(default_factory=list)
    mu_index: int = 0
    grid_index: int = 0
    grid_name: str = ""
    view_start: int = 0
    view_end: int = 0
    nbextchan: int = Field(1000, ge=1)
    pulse_train: list[float] = Field(default_factory=list)
    use_peeloff: bool = False
    peel_off_win: float = Field(0.025, gt=0)
    compute_dtype: Literal["float32", "float64"] = "float32"
    mu_grid_index: list[int] = Field(default_factory=list)
    inactive_mus: list[int] = Field(default_factory=list)
    artifact_times: list[int] = Field(default_factory=list)
    lock_spikes: bool = False
    artifact_regions: list[Any] | None = None
