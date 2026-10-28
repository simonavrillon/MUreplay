"""Pydantic request schemas for the MUreplay API: one model per POST body."""

from __future__ import annotations

from pydantic import BaseModel, Field

from mureplay.replay.filter_update import (
    DEFAULT_COMPUTE_DTYPE,
    DEFAULT_NBEXTCHAN,
    DEFAULT_PEEL_OFF_WIN_SEC,
    ComputeDtype,
)


class LoadPairedFromPathPayload(BaseModel):
    """The decomposition or edit log the user chose."""

    file_path: str


class UpdateFilterPayload(BaseModel):
    """A logged ``update_filter`` step, with the replay state it runs on."""

    bids_root: str
    entity_label: str
    spike_times: list[list[int]]
    mu: int
    grid_name: str = ""
    view_start: int
    view_end: int
    nbextchan: int = Field(DEFAULT_NBEXTCHAN, ge=1)
    pulse_train: list[float] = Field(default_factory=list)
    use_peeloff: bool = False
    peel_off_win: float = Field(DEFAULT_PEEL_OFF_WIN_SEC, gt=0)
    compute_dtype: ComputeDtype = DEFAULT_COMPUTE_DTYPE
    mu_grid_index: list[int]
    inactive_mus: list[int] = Field(default_factory=list)
    artifact_times: list[int] = Field(default_factory=list)
    lock_spikes: bool = False
    artifact_regions: list[tuple[int, int]] = Field(default_factory=list)
