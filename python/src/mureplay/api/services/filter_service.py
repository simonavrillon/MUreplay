"""Filter service: re-run MUedit-style filter update for one MU."""

from __future__ import annotations

from pathlib import Path

import numpy as np

from mureplay.io.bids import load_bids_emg_grid
from mureplay.replay.artifact_mask import build_manual_artifact_mask, parse_artifact_regions
from mureplay.replay.filter_update import update_motor_unit_filter_window
from mureplay.replay.operations import normalize_distimes


def run_update_filter(payload: dict) -> dict:
    """Run MUedit-style filter update for one MU and return updated spikes/pulse."""
    bids_root = str(payload.get("bids_root") or "").strip()
    entity_label = str(payload.get("entity_label") or "").strip()
    if not bids_root or not entity_label:
        raise ValueError("Missing required fields for update_filter: bids_root and entity_label.")

    distimes = normalize_distimes(payload.get("distimes") or [])
    mu_index = int(payload.get("mu_index") or 0)
    if mu_index < 0 or mu_index >= len(distimes):
        raise ValueError("MU index is out of range.")

    grid_index = int(payload.get("grid_index") or 0)
    view_start = int(payload.get("view_start") or 0)
    view_end = int(payload.get("view_end") or 0)
    if view_end <= view_start:
        raise ValueError("Invalid view range: view_end must be greater than view_start.")

    nbextchan = int(payload.get("nbextchan") or 1000)
    pulse_train = np.asarray(payload.get("pulse_train") or [], dtype=float)
    use_peeloff = bool(payload.get("use_peeloff", False))
    peeloff_win = float(payload.get("peeloff_win") or 0.025)
    mu_grid_index = [int(v) for v in (payload.get("mu_grid_index") or [])]
    peeloff_spike_times = [
        distimes[i]
        for i in range(len(distimes))
        if i != mu_index and (mu_grid_index[i] if i < len(mu_grid_index) else 0) == grid_index
    ]
    artifact_times_raw = payload.get("artifact_times") or []
    artifact_times = [int(x) for x in artifact_times_raw if isinstance(x, (int, float))]
    lock_spikes = bool(payload.get("lock_spikes", False))
    artifact_regions = parse_artifact_regions(payload.get("artifact_regions"))
    artifact_mask = build_manual_artifact_mask(artifact_regions, view_end)

    emg, fsamp, emg_mask = load_bids_emg_grid(
        Path(bids_root),
        entity_label,
        grid_index,
        read_start=view_start,
        read_n=view_end - view_start,
    )
    pt, updated = update_motor_unit_filter_window(
        emg,
        emg_mask,
        distimes[mu_index],
        float(fsamp),
        view_start,
        view_end,
        nbextchan=nbextchan,
        emg_offset=view_start,
        peeloff_spike_times=peeloff_spike_times,
        peeloff_win=peeloff_win,
        use_peeloff=use_peeloff,
        artifact_times=artifact_times or None,
        lock_spikes=lock_spikes,
        artifact_mask=artifact_mask,
    )
    updated_pulse = None
    if pulse_train.size and pt is not None:
        edge = int(round(0.1 * fsamp))
        seg_start = view_start + edge
        seg_end = min(view_start + len(pt) - edge, pulse_train.shape[0])
        if seg_end > seg_start and len(pt) > 2 * edge:
            pulse_train[seg_start:seg_end] = pt[edge : edge + (seg_end - seg_start)]
        updated_pulse = pulse_train.tolist()

    return {
        "fsamp": float(fsamp),
        "distimes": updated,
        "pulse_train": updated_pulse,
    }
