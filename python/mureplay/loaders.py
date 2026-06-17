"""NPZ/JSON loading and paired decomp resolution helpers."""

from __future__ import annotations

import io
import json
import re
from pathlib import Path
from typing import Any

import numpy as np


def decode_scalar(value: Any) -> Any:
    if isinstance(value, bytes):
        return value.decode("utf-8", errors="replace")
    if isinstance(value, np.generic):
        return value.item()
    return value


def to_serializable(value: Any) -> Any:
    if isinstance(value, np.ndarray):
        if value.dtype.kind in {"S", "U"}:
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
    for key in keys:
        if key in payload:
            return payload[key]
    return default


def load_npz_payload(raw_bytes: bytes) -> dict[str, Any]:
    """Normalize MUedit-style NPZ bytes into a stable JSON-serializable payload."""
    with np.load(io.BytesIO(raw_bytes), allow_pickle=True) as npz:
        data = {key: to_serializable(npz[key]) for key in npz.files}

    pulse_trains = first_present(data, "pulse_trains", "pulseTrains", default=[])
    discharge_times = first_present(data, "discharge_times", "distimes", "dischargeTimes", default=[])
    payload = {
        "fsamp": float(first_present(data, "fsamp", "fs", default=2048)),
        "pulse_trains": pulse_trains,
        "discharge_times": discharge_times,
        "grid_names": first_present(data, "grid_names", default=[]),
        "mu_grid_index": first_present(data, "mu_grid_index", default=[]),
        "mu_uids": first_present(data, "mu_uids", default=[]),
    }

    raw_hist = first_present(data, "edit_history", "history", default=[])
    if isinstance(raw_hist, str):
        try:
            raw_hist = json.loads(raw_hist)
        except json.JSONDecodeError:
            raw_hist = []
    if isinstance(raw_hist, list):
        payload["edit_history"] = raw_hist

    return payload


def entity_from_filename(name: str) -> str:
    stem = Path(str(name)).stem
    if stem.endswith("_edited"):
        return stem[: -len("_edited")]
    if stem.endswith("_decomp"):
        return stem[: -len("_decomp")]
    return stem


def find_single(root: Path, pattern: str) -> Path:
    matches = sorted(root.rglob(pattern))
    if not matches:
        raise FileNotFoundError(f"Cannot find '{pattern}' under '{root}'.")
    return matches[0]


def infer_bids_root(file_path: Path) -> str:
    """Infer the BIDS dataset root from a decomp/edited file path.

    The root is the path segment before the first `sub-*` folder. MUedit2 now
    saves decompositions under `<root>/derivatives/muedit/sub-XX/.../decomp/`,
    so when the inferred prefix ends with `derivatives/<pipeline>` we strip those
    two parts to return the true dataset root (where raw `<root>/sub-XX/emg/`
    lives). Old flat layouts (no `derivatives/`) are unaffected.
    """
    for i, part in enumerate(file_path.parts):
        if part.startswith("sub-"):
            prefix = file_path.parts[:i]
            if len(prefix) >= 2 and prefix[-2] == "derivatives":
                prefix = prefix[:-2]
            return str(Path(*prefix)) if prefix else ""
    return ""


def _merge_sidecar(decomp_payload: dict[str, Any], edited_json_path: Path) -> None:
    try:
        sidecar = json.loads(edited_json_path.read_text(encoding="utf-8"))
    except Exception as exc:  # noqa: BLE001
        raise ValueError(f"Failed to parse sidecar JSON: {edited_json_path}.") from exc

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


def api_load_paired_decomp(payload: dict[str, Any]) -> dict[str, Any]:
    """Load `<entity>_decomp.npz` with matching `<entity>_edited.json` from BIDS root."""
    bids_root = Path(str(payload.get("bids_root") or "").strip())
    if not str(bids_root):
        raise ValueError("BIDS root is required.")
    if not bids_root.exists():
        raise FileNotFoundError(f"BIDS root not found: {bids_root}.")

    entity = str(payload.get("entity_label") or "").strip()
    if not entity:
        edited_filename = str(payload.get("edited_filename") or "").strip()
        if not edited_filename:
            raise ValueError("entity_label or edited_filename is required.")
        entity = entity_from_filename(edited_filename)
    if not entity:
        raise ValueError("Cannot infer entity label.")

    decomp_path = find_single(bids_root, f"{entity}_decomp.npz")
    edited_json_path = find_single(bids_root, f"{entity}_edited.json")

    decomp_payload = load_npz_payload(decomp_path.read_bytes())
    decomp_payload["source_kind"] = "decomp_paired"
    decomp_payload["source_filename"] = decomp_path.name
    _merge_sidecar(decomp_payload, edited_json_path)
    decomp_payload["paired_files"] = {
        "decomp_npz": str(decomp_path),
        "edited_json": str(edited_json_path),
    }
    return decomp_payload


def api_load_paired_from_path(payload: dict[str, Any]) -> dict[str, Any]:
    """Resolve and load a paired decomp/log set from a selected file path."""
    file_path = Path(str(payload.get("file_path") or "").strip())
    if not file_path.name:
        raise ValueError("file_path is required.")
    if not file_path.exists():
        raise FileNotFoundError(f"File not found: {file_path}.")

    entity = entity_from_filename(file_path.name)
    if not entity:
        raise ValueError(f"Cannot infer entity label from: {file_path.name}.")

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
        raise FileNotFoundError(f"No decomp NPZ found for '{entity}' in {directory}.")

    json_candidates = list(directory.glob(f"{entity}_edited.json"))
    if not json_candidates:
        raise FileNotFoundError(f"No paired edited JSON found for '{entity}' in {directory}.")
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
