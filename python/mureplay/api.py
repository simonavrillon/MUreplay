"""Backend API handlers for edit/replay operations.

These functions are called by the HTTP layer in `python/server.py`.
"""

from __future__ import annotations

from pathlib import Path
from typing import Any

import numpy as np

from .bids import load_bids_emg_grid, parse_entity_label
from .filter_update import update_motor_unit_filter_window
from .loaders import api_load_paired_decomp, api_load_paired_from_path, load_npz_payload
from .replay_ops import (
    add_spikes_in_roi,
    build_pulse_trains_from_distimes,
    delete_high_discharge_rate_spikes_in_roi,
    delete_spikes_in_roi,
    normalize_distimes,
    remove_discharge_rate_outliers,
)
from .save import generate_mu_uids, save_editlog, save_npz


def api_load_npz(raw_bytes: bytes) -> dict[str, Any]:
    """Parse an uploaded NPZ payload into frontend-ready JSON data."""
    return load_npz_payload(raw_bytes)


def api_update_filter(payload: dict[str, Any]) -> dict[str, Any]:
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


def api_add_spikes(payload: dict[str, Any]) -> dict[str, Any]:
    """Add spikes within a ROI by peak-picking the pulse train above a threshold."""
    distimes = normalize_distimes(payload.get("distimes") or [])
    mu_index = int(payload.get("mu_index") or 0)
    if mu_index < 0 or mu_index >= len(distimes):
        raise ValueError("MU index is out of range.")
    pulse = np.asarray(payload.get("pulse_train") or [], dtype=float)
    fsamp = float(payload.get("fsamp") or 0)
    if fsamp <= 0:
        raise ValueError("Sampling rate (fsamp) is required.")
    out = add_spikes_in_roi(
        pulse,
        distimes[mu_index],
        fsamp,
        int(payload.get("x_start") or 0),
        int(payload.get("x_end") or 0),
        float(payload.get("y_min") or 0),
    )
    return {"distimes": out}


def api_delete_spikes(payload: dict[str, Any]) -> dict[str, Any]:
    """Delete spikes within a ROI bounding box from the discharge times of one MU."""
    distimes = normalize_distimes(payload.get("distimes") or [])
    mu_index = int(payload.get("mu_index") or 0)
    if mu_index < 0 or mu_index >= len(distimes):
        raise ValueError("MU index is out of range.")
    pulse = np.asarray(payload.get("pulse_train") or [], dtype=float)
    out = delete_spikes_in_roi(
        pulse,
        distimes[mu_index],
        int(payload.get("x_start") or 0),
        int(payload.get("x_end") or 0),
        float(payload.get("y_min") or 0),
        float(payload.get("y_max") or 0),
    )
    return {"distimes": out}


def api_delete_dr(payload: dict[str, Any]) -> dict[str, Any]:
    """Delete spikes with abnormally high discharge rate within a ROI."""
    distimes = normalize_distimes(payload.get("distimes") or [])
    mu_index = int(payload.get("mu_index") or 0)
    if mu_index < 0 or mu_index >= len(distimes):
        raise ValueError("MU index is out of range.")
    pulse = np.asarray(payload.get("pulse_train") or [], dtype=float)
    fsamp = float(payload.get("fsamp") or 0)
    if fsamp <= 0:
        raise ValueError("Sampling rate (fsamp) is required.")
    out = delete_high_discharge_rate_spikes_in_roi(
        pulse,
        distimes[mu_index],
        fsamp,
        int(payload.get("x_start") or 0),
        int(payload.get("x_end") or 0),
        float(payload.get("y_min") or 0),
    )
    return {"distimes": out}


def api_remove_outliers(payload: dict[str, Any]) -> dict[str, Any]:
    """Remove discharge-rate outliers from the full spike train of one MU."""
    distimes = normalize_distimes(payload.get("distimes") or [])
    mu_index = int(payload.get("mu_index") or 0)
    if mu_index < 0 or mu_index >= len(distimes):
        raise ValueError("MU index is out of range.")
    pulse = np.asarray(payload.get("pulse_train") or [], dtype=float)
    fsamp = float(payload.get("fsamp") or 0)
    if fsamp <= 0:
        raise ValueError("Sampling rate (fsamp) is required.")
    source = distimes[mu_index]
    out = remove_discharge_rate_outliers(pulse, source, fsamp)
    return {"distimes": out, "removed_count": max(0, len(source) - len(out))}


def api_flag_mu(payload: dict[str, Any]) -> dict[str, Any]:
    """Toggle the flagged state of one MU; returns the new flag value."""
    distimes = normalize_distimes(payload.get("distimes") or [])
    mu_index = int(payload.get("mu_index") or 0)
    if mu_index < 0 or mu_index >= len(distimes):
        raise ValueError("MU index is out of range.")
    return {"flagged": bool(payload.get("flagged", True))}


def api_save_edits(payload: dict[str, Any]) -> dict[str, Any]:
    """Persist current replay state to `<entity>_edited.npz` + sidecar JSON."""
    bids_root = str(payload.get("bids_root") or "").strip()
    entity_label = str(payload.get("entity_label") or "").strip()
    if not bids_root or not entity_label:
        raise ValueError("Missing required fields: bids_root and entity_label.")

    distimes = normalize_distimes(payload.get("distimes") or payload.get("discharge_times") or [])
    if not distimes:
        raise ValueError("Discharge times are required.")

    total_samples = int(payload.get("total_samples") or 0)
    if total_samples <= 0:
        raise ValueError("total_samples is required and must be > 0.")

    fsamp = float(payload.get("fsamp") or 2048)
    grid_names = payload.get("grid_names") or ["Grid 1"]
    mu_grid_index = payload.get("mu_grid_index") or [0] * len(distimes)
    parameters = payload.get("parameters") or {}

    pulse_raw = payload.get("pulse_trains")
    pulse_trains = None
    if pulse_raw is not None:
        try:
            pulse_trains = np.asarray(pulse_raw, dtype=float)
        except Exception:  # noqa: BLE001
            pulse_trains = None
    if (
        pulse_trains is None
        or pulse_trains.ndim != 2
        or pulse_trains.shape[0] != len(distimes)
        or pulse_trains.shape[1] != total_samples
    ):
        pulse_trains = build_pulse_trains_from_distimes(distimes, total_samples)

    mu_uids_raw = payload.get("mu_uids")
    if isinstance(mu_uids_raw, list) and len(mu_uids_raw) == len(distimes):
        mu_uids = [str(x) for x in mu_uids_raw]
    else:
        mu_uids = generate_mu_uids([int(x) for x in mu_grid_index])

    edit_history = payload.get("edit_history") or []
    if not isinstance(edit_history, list):
        edit_history = []

    subject, session = parse_entity_label(entity_label)
    base_dir = Path(bids_root) / f"sub-{subject}"
    if session:
        base_dir = base_dir / f"ses-{session}"
    decomp_dir = base_dir / "decomp"
    decomp_dir.mkdir(parents=True, exist_ok=True)

    out_path = decomp_dir / f"{entity_label}_edited.npz"
    save_npz(
        out_path,
        pulse_trains,
        distimes,
        fsamp,
        [str(x) for x in grid_names],
        [int(x) for x in mu_grid_index],
        parameters,
        total_samples,
    )
    save_editlog(out_path.with_suffix(".json"), mu_uids, edit_history)
    return {"saved": True, "path": str(out_path)}


__all__ = [
    "api_add_spikes",
    "api_delete_dr",
    "api_delete_spikes",
    "api_flag_mu",
    "api_load_npz",
    "api_load_paired_decomp",
    "api_load_paired_from_path",
    "api_remove_outliers",
    "api_save_edits",
    "api_update_filter",
]
