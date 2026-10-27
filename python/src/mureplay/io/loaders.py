"""NPZ/JSON loading and paired decomp resolution helpers."""

from __future__ import annotations

import io
import json
import re
from pathlib import Path
from typing import Any

import numpy as np

from mureplay.errors import MureplayError, NotFoundError
from mureplay.replay.artifact_mask import mask_to_regions
from mureplay.replay.operations import build_pulse_trains_from_distimes

#: Member MUedit2 writes to mark a schema v2 decomposition file; absent in v1.
SCHEMA_KEY = "schema_version"


def decode_scalar(value: Any) -> Any:
    """A NumPy scalar or bytes value as plain Python."""
    if isinstance(value, bytes):
        return value.decode("utf-8", errors="replace")
    if isinstance(value, np.generic):
        return value.item()
    return value


def to_serializable(value: Any) -> Any:
    """An NPZ member as JSON-ready lists, strings and numbers."""
    if isinstance(value, np.ndarray):
        if value.dtype.kind in {"S", "U"}:
            if value.ndim == 0:
                # A 0-d string array holds one string (schema v2 JSON members).
                return decode_scalar(value.item())
            return [str(v) for v in value.tolist()]
        if value.dtype == object:
            return [to_serializable(v) for v in value.tolist()]
        return value.tolist()
    if isinstance(value, (list, tuple)):
        return [to_serializable(v) for v in value]
    if isinstance(value, dict):
        return {str(k): to_serializable(v) for k, v in value.items()}
    return decode_scalar(value)


def first_present(payload: dict[str, Any], *keys: str, default: Any = None) -> Any:
    """The value of the first of ``keys`` in ``payload``, else ``default``."""
    for key in keys:
        if key in payload:
            return payload[key]
    return default


def _json_member(data: dict[str, Any], key: str) -> Any | None:
    """A schema v2 JSON member (stored as one string), or the raw v1 value."""
    raw = data.get(key)
    if isinstance(raw, str):
        try:
            return json.loads(raw)
        except json.JSONDecodeError:
            return None
    return raw


def _unpack_spike_csr(data: dict[str, Any]) -> list[list[int]]:
    """Per-MU discharge times from the schema v2 ``spike_times`` CSR pair."""
    spikes = data.get("spike_times")
    offsets = data.get("spike_offsets")
    if not isinstance(spikes, list) or not isinstance(offsets, list):
        return []
    rows: list[list[int]] = []
    for i in range(len(offsets) - 1):
        start, end = int(offsets[i]), int(offsets[i + 1])
        rows.append([int(v) for v in spikes[start:end]])
    return rows


def load_npz_payload(raw_bytes: bytes) -> dict[str, Any]:
    """Normalize MUedit-style NPZ bytes into a stable JSON-serializable payload."""
    # MUedit2 writes two layouts: schema v1 (object arrays, discharge_times, artifact_mask)
    # and schema v2 (CSR spike_times/spike_offsets, JSON members, artifact_intervals).
    with np.load(io.BytesIO(raw_bytes), allow_pickle=True) as npz:
        data = {key: to_serializable(npz[key]) for key in npz.files}

    distimes = first_present(data, "discharge_times", "distimes", "dischargeTimes", default=None)
    if distimes is None:
        distimes = _unpack_spike_csr(data)
    if not isinstance(distimes, list):
        distimes = []

    pulse_trains = first_present(data, "pulse_trains", "pulseTrains", default=None)
    if pulse_trains is None:
        # Spikes-only file: MUedit2's loader draws binary trains from the
        # discharge times, so the replay payload does the same.
        total = int(first_present(data, "total_samples", default=0) or 0)
        pulse_trains = (
            build_pulse_trains_from_distimes([list(row) for row in distimes], total).tolist()
            if distimes
            else []
        )

    grid_names = _json_member(data, "grid_names")
    if not isinstance(grid_names, list):
        grid_names = first_present(data, "grid_names", default=[])
    payload = {
        "fsamp": float(first_present(data, "fsamp", "fs", default=2048)),
        "pulse_trains": pulse_trains,
        "discharge_times": distimes,
        "grid_names": grid_names,
        "mu_grid_index": first_present(data, "mu_grid_index", default=[]),
        "mu_uids": first_present(data, "mu_uids", default=[]),
        "total_samples": int(first_present(data, "total_samples", default=0) or 0),
    }

    raw_hist = first_present(data, "edit_history", "history", default=[])
    if isinstance(raw_hist, str):
        try:
            raw_hist = json.loads(raw_hist)
        except json.JSONDecodeError:
            raw_hist = []
    if isinstance(raw_hist, list):
        payload["edit_history"] = raw_hist

    artifact_intervals = _json_member(data, "artifact_intervals")
    if isinstance(artifact_intervals, list):
        regions = [[int(s), int(e)] for s, e in artifact_intervals]
        payload["artifact_regions"] = regions
        payload["artifact_samples"] = sum(e - s for s, e in regions)
    else:
        artifact_mask_raw = data.get("artifact_mask")
        if artifact_mask_raw is not None:
            mask = np.asarray(artifact_mask_raw, dtype=bool)
            regions = mask_to_regions(mask)
            payload["artifact_regions"] = regions
            payload["artifact_samples"] = int(mask.sum())

    return payload


def entity_from_filename(name: str) -> str:
    """The BIDS entity label of a ``_decomp``/``_edited`` file name."""
    stem = Path(str(name)).stem
    if stem.endswith("_edited"):
        return stem[: -len("_edited")]
    if stem.endswith("_decomp"):
        return stem[: -len("_decomp")]
    return stem


def infer_bids_root(file_path: Path) -> str:
    """The BIDS dataset root of a decomp/edited file: the folder above its ``sub-*`` folder."""
    # MUedit2 saves under <root>/derivatives/muedit/sub-XX/.../decomp/, while the raw EMG is
    # under <root>/sub-XX/emg/, so a trailing derivatives/<pipeline> is dropped too.
    for i, part in enumerate(file_path.parts):
        if part.startswith("sub-"):
            prefix = file_path.parts[:i]
            if len(prefix) >= 2 and prefix[-2] == "derivatives":
                prefix = prefix[:-2]
            return str(Path(*prefix)) if prefix else ""
    return ""


def _merge_sidecar(decomp_payload: dict[str, Any], edited_json_path: Path) -> None:
    """Add the edit log, uids and artifact times of ``_edited.json`` to the payload."""
    try:
        sidecar = json.loads(edited_json_path.read_text(encoding="utf-8"))
    except (OSError, UnicodeDecodeError, json.JSONDecodeError) as exc:
        raise MureplayError(
            f"The edit log {edited_json_path} could not be read; it is not valid JSON.",
            field="file_path",
        ) from exc

    history = []
    if isinstance(sidecar, dict):
        raw_hist = sidecar.get("history")
        if isinstance(raw_hist, list):
            history = raw_hist
        mu_uids = sidecar.get("mu_uids")
        if isinstance(mu_uids, list) and mu_uids:
            decomp_payload["mu_uids"] = mu_uids
        artifact_times = sidecar.get("artifact_times")
        if isinstance(artifact_times, list):
            decomp_payload["artifact_times"] = artifact_times
    decomp_payload["edit_history"] = history


def load_paired_from_path(file_path: Path) -> dict[str, Any]:
    """Resolve and load a paired decomp/log set from a selected file path."""
    if not file_path.name:
        raise MureplayError("Choose a file to open.", field="file_path")
    if not file_path.exists():
        raise NotFoundError(f"File not found: {file_path}.", field="file_path")

    entity = entity_from_filename(file_path.name)
    if not entity:
        raise MureplayError(
            f"Cannot tell the recording from the file name {file_path.name}.", field="file_path"
        )

    directory = file_path.parent

    decomp_path: Path | None = None
    exact = list(directory.glob(f"{entity}_decomp.npz"))
    if exact:
        decomp_path = exact[0]
    else:
        run_m = re.search(r"run-(\d+)", entity)
        if run_m:
            bids_candidates = sorted(directory.glob(f"*_run-{run_m.group(1)}_*_decomp.npz"))
            if bids_candidates:
                decomp_path = bids_candidates[0]
    if decomp_path is None:
        edited_candidates = list(directory.glob(f"{entity}_edited.npz"))
        if edited_candidates:
            decomp_path = edited_candidates[0]
    if decomp_path is None:
        raise NotFoundError(
            f"No decomp NPZ found for '{entity}' in {directory}.", field="file_path"
        )

    json_candidates = list(directory.glob(f"{entity}_edited.json"))
    if not json_candidates:
        raise NotFoundError(
            f"No paired edited JSON found for '{entity}' in {directory}.", field="file_path"
        )
    edited_json_path = json_candidates[0]

    decomp_payload = load_npz_payload(decomp_path.read_bytes())
    decomp_payload["source_kind"] = "decomp_paired"
    decomp_payload["source_filename"] = decomp_path.name
    _merge_sidecar(decomp_payload, edited_json_path)
    decomp_payload["bids_root"] = infer_bids_root(file_path)
    decomp_payload["entity_label"] = entity
    decomp_payload["bids_entity_label"] = entity_from_filename(decomp_path.name)
    decomp_payload["paired_files"] = {
        "decomp_npz": str(decomp_path),
        "edited_json": str(edited_json_path),
    }
    return decomp_payload
