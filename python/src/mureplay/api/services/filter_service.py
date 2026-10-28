"""Filter service: re-run MUedit-style filter update for one MU."""

from __future__ import annotations

from pathlib import Path
from typing import Any

import numpy as np

from mureplay.errors import MureplayError
from mureplay.io.bids import load_bids_emg_grid
from mureplay.replay.artifact_mask import build_manual_artifact_mask, parse_artifact_regions
from mureplay.replay.filter_update import (
    edge_samples,
    emg_filter_inplace,
    update_motor_unit_filter_window,
)
from mureplay.replay.operations import normalize_distimes

#: The intramuscular grids of MUedit2's catalogue (``signal/grid.py``), matched as substrings
#: of the grid name like MUedit2 does; every other grid takes the surface bandpass.
INTRAMUSCULAR_GRIDS = ("MYOMRF-4x8", "MYOMNP-1x32")


def emg_type(grid_name: str) -> int:
    """The bandpass MUedit2 filters ``grid_name`` with: 2 for intramuscular, 1 for surface."""
    return 2 if any(key in grid_name for key in INTRAMUSCULAR_GRIDS) else 1


def run_update_filter(payload: dict[str, Any]) -> dict[str, Any]:
    """Refit one MU's filter as MUedit2 does and return its new discharges and pulse train."""
    bids_root = str(payload.get("bids_root") or "").strip()
    entity_label = str(payload.get("entity_label") or "").strip()
    if not bids_root or not entity_label:
        raise MureplayError(
            "This step needs the BIDS dataset and recording of the session.", field="bids_root"
        )

    distimes = normalize_distimes(payload.get("distimes") or [])
    mu_index = int(payload.get("mu_index") or 0)
    if mu_index < 0 or mu_index >= len(distimes):
        raise MureplayError("MU index is out of range.", field="mu_index")

    grid_index = int(payload.get("grid_index") or 0)
    view_start = int(payload.get("view_start") or 0)
    view_end = int(payload.get("view_end") or 0)
    if view_end <= view_start:
        raise MureplayError("The step's window ends before it starts.", field="view_end")

    pulse_train = np.asarray(payload.get("pulse_train") or [], dtype=float)
    mu_grid_index = [int(v) for v in (payload.get("mu_grid_index") or [])]
    inactive = {int(v) for v in payload.get("inactive_mus") or []}
    # MUedit2 peels off the other live MUs of the grid; flagged and removed ones are left out.
    peel_off_spike_times = [
        distimes[i]
        for i in range(len(distimes))
        if i != mu_index
        and i not in inactive
        and (mu_grid_index[i] if i < len(mu_grid_index) else 0) == grid_index
    ]
    artifact_times = [int(x) for x in payload.get("artifact_times") or []]
    artifact_regions = parse_artifact_regions(payload.get("artifact_regions"))

    emg, fsamp, discard_mask = load_bids_emg_grid(Path(bids_root), entity_label, grid_index)
    if view_end > emg.shape[1]:
        raise MureplayError(
            "The step's window runs past the end of the EMG recording.", field="view_end"
        )
    emg = np.ascontiguousarray(emg, dtype=np.float32)
    emg_filter_inplace(emg, float(fsamp), emg_type(str(payload.get("grid_name") or "")))
    artifact_mask = build_manual_artifact_mask(artifact_regions, emg.shape[1])

    pt, updated = update_motor_unit_filter_window(
        emg,
        discard_mask,
        distimes[mu_index],
        float(fsamp),
        view_start,
        view_end,
        nbextchan=int(payload.get("nbextchan") or 1000),
        peel_off_spike_times=peel_off_spike_times if payload.get("use_peeloff") else None,
        peel_off_win=float(payload.get("peel_off_win") or 0.025),
        artifact_times=artifact_times,
        lock_spikes=bool(payload.get("lock_spikes", False)),
        artifact_mask=artifact_mask,
        compute_dtype=str(payload.get("compute_dtype") or "float32"),
    )
    updated_pulse = None
    if pulse_train.size and pt is not None:
        edge = edge_samples(fsamp)
        seg_start = view_start + edge
        seg_end = min(view_start + len(pt) - edge, pulse_train.shape[0])
        if seg_end > seg_start and len(pt) > 2 * edge:
            pulse_train[seg_start:seg_end] = pt[edge : edge + (seg_end - seg_start)]
        updated_pulse = pulse_train.tolist()

    return {
        "fsamp": float(fsamp),
        "distimes": updated.tolist(),
        "pulse_train": updated_pulse,
    }
