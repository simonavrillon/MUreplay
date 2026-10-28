"""Decomposition NPZ and edit-log loading, and the pairing of the two."""

from __future__ import annotations

import json
import re
from itertools import pairwise
from pathlib import Path
from typing import Any, BinaryIO

import numpy as np
from numpy.lib.npyio import NpzFile

from mureplay.errors import MureplayError, NotFoundError
from mureplay.paths import data_root
from mureplay.replay.artifact_mask import mask_to_intervals
from mureplay.replay.filter_update import (
    DEFAULT_COMPUTE_DTYPE,
    DEFAULT_NBEXTCHAN,
    DEFAULT_PEEL_OFF_WIN_SEC,
)

#: Member MUedit2 writes to mark a schema v2 decomposition file; absent in v1.
_SCHEMA_KEY = "schema_version"


def _build_pulse_trains_from_spike_times(
    spike_times: list[list[int]], total_samples: int
) -> np.ndarray:
    """Binary pulse trains, 1 at each discharge, for files saved without pulse trains."""
    pulses = np.zeros((len(spike_times), total_samples), dtype=float)
    for i, spikes in enumerate(spike_times):
        if not spikes:
            continue
        t = np.asarray(spikes, dtype=int)
        t = t[(t >= 0) & (t < total_samples)]
        pulses[i, t] = 1.0
    return pulses


def _unpack_csr(values: np.ndarray, offsets: np.ndarray) -> list[list[int]]:
    """The per-MU rows of a CSR pair such as ``spike_times``/``spike_offsets``."""
    return [values[int(a) : int(b)].astype(int).tolist() for a, b in pairwise(offsets)]


def _unwrap_parameters(raw: Any) -> dict[str, Any]:
    """The run's saved settings from a pickled dict in a 0-d object array (schema v1)."""
    if isinstance(raw, np.ndarray) and raw.dtype == object and raw.size == 1:
        raw = raw.item()
    if not isinstance(raw, dict):
        return {}
    return {str(k): v.item() if isinstance(v, np.generic) else v for k, v in raw.items()}


def _json_member(npz: NpzFile, key: str, default: Any) -> Any:
    """A schema v2 member stored as JSON in one string."""
    raw = npz.get(key)
    return json.loads(str(raw)) if raw is not None else default


def _npz_v2(npz: NpzFile) -> dict[str, Any]:
    """The decomposition fields of a schema v2 file."""
    spikes, offsets = npz.get("spike_times"), npz.get("spike_offsets")
    intervals = npz.get("artifact_intervals")
    parameters = _json_member(npz, "parameters", {})
    return {
        "spike_times": (
            _unpack_csr(spikes, offsets) if spikes is not None and offsets is not None else []
        ),
        "pulse_trains": npz.get("pulse_trains"),
        "fsamp": npz.get("fsamp"),
        "total_samples": npz.get("total_samples"),
        "grid_names": [str(g) for g in _json_member(npz, "grid_names", [])],
        "mu_grid_index": npz.get("mu_grid_index"),
        "parameters": parameters if isinstance(parameters, dict) else {},
        "artifact_regions": (
            [[int(s), int(e)] for s, e in intervals] if intervals is not None else None
        ),
    }


def _npz_v1(npz: NpzFile) -> dict[str, Any]:
    """The decomposition fields of a schema v1 file (object arrays, a pickled dict)."""
    raw_spikes = npz.get("discharge_times")
    grid_names = npz.get("grid_names")
    mask = npz.get("artifact_mask")
    return {
        "spike_times": (
            [np.asarray(row, dtype=int).reshape(-1).tolist() for row in raw_spikes]
            if raw_spikes is not None
            else []
        ),
        "pulse_trains": npz.get("pulse_trains"),
        "fsamp": npz.get("fsamp"),
        "total_samples": npz.get("total_samples"),
        "grid_names": [str(g) for g in grid_names.tolist()] if grid_names is not None else [],
        "mu_grid_index": npz.get("mu_grid_index"),
        "parameters": _unwrap_parameters(npz.get("parameters")),
        "artifact_regions": (
            mask_to_intervals(np.asarray(mask, dtype=bool)) if mask is not None else None
        ),
    }


def _refit_settings(parameters: dict[str, Any]) -> dict[str, Any]:
    """The run settings an ``update_filter`` refit repeats; MUedit2's defaults where unusable."""
    nbextchan = parameters.get("nbextchan")
    peel_off_win = parameters.get("peel_off_win")
    return {
        "nbextchan": nbextchan
        if isinstance(nbextchan, int) and nbextchan > 0
        else DEFAULT_NBEXTCHAN,
        "peel_off_win": (
            peel_off_win
            if isinstance(peel_off_win, int | float) and peel_off_win > 0
            else DEFAULT_PEEL_OFF_WIN_SEC
        ),
        "compute_dtype": (
            "float64" if parameters.get("compute_dtype") == "float64" else DEFAULT_COMPUTE_DTYPE
        ),
    }


def _load_npz_payload(source: Path | BinaryIO) -> dict[str, Any]:
    """The JSON-ready decomposition of a MUedit2 ``.npz``, in either schema."""
    # np.load reads a member only when it is accessed, so an embedded EMG is never read.
    with np.load(source, allow_pickle=True) as npz:
        fields = _npz_v2(npz) if _SCHEMA_KEY in npz else _npz_v1(npz)

    spike_times = fields["spike_times"]
    total_samples = int(fields["total_samples"]) if fields["total_samples"] is not None else 0
    pulse_trains = fields["pulse_trains"]
    if pulse_trains is None:
        # Spikes-only file: MUedit2's loader draws binary trains from the
        # discharge times, so the replay payload does the same.
        pulse_trains = _build_pulse_trains_from_spike_times(spike_times, total_samples)
    raw_grid_index = fields["mu_grid_index"]
    mu_grid_index = (
        np.asarray(raw_grid_index).astype(int).tolist() if raw_grid_index is not None else []
    )
    if len(mu_grid_index) != len(spike_times):
        mu_grid_index = [0] * len(spike_times)

    payload: dict[str, Any] = {
        "fsamp": float(fields["fsamp"]) if fields["fsamp"] is not None else 2048.0,
        "pulse_trains": np.asarray(pulse_trains).tolist(),
        "spike_times": spike_times,
        "grid_names": fields["grid_names"] or ["Grid 1"],
        "mu_grid_index": mu_grid_index,
        "refit_settings": _refit_settings(fields["parameters"]),
    }
    if fields["artifact_regions"] is not None:
        payload["artifact_regions"] = fields["artifact_regions"]
    return payload


def _entity_label_from_filename(name: str) -> str:
    """The BIDS entity label of a ``_decomp``/``_edited`` file name."""
    stem = Path(name).stem
    if stem.endswith("_edited"):
        return stem[: -len("_edited")]
    if stem.endswith("_decomp"):
        return stem[: -len("_decomp")]
    return stem


def _infer_bids_root(file_path: Path) -> str:
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


def _merge_edit_log(payload: dict[str, Any], edit_log_path: Path) -> None:
    """Add the history, uids and artifact markers of ``_edited.json`` to the payload."""
    try:
        edit_log = json.loads(edit_log_path.read_text(encoding="utf-8"))
    except (OSError, UnicodeDecodeError, json.JSONDecodeError) as exc:
        raise MureplayError(
            f"The edit log {edit_log_path} could not be read; it is not valid JSON.",
            field="file_path",
        ) from exc

    history = []
    if isinstance(edit_log, dict):
        if isinstance(edit_log.get("history"), list):
            history = edit_log["history"]
        if isinstance(edit_log.get("mu_uids"), list) and edit_log["mu_uids"]:
            payload["mu_uids"] = edit_log["mu_uids"]
        if isinstance(edit_log.get("artifact_times"), list):
            payload["artifact_times"] = edit_log["artifact_times"]
    payload["edit_history"] = history


def _find_decomposition(directory: Path, entity_label: str) -> Path | None:
    """The decomposition to replay from: ``_decomp.npz``, a same-run one, else ``_edited.npz``."""
    exact = directory / f"{entity_label}_decomp.npz"
    if exact.exists():
        return exact
    run = re.search(r"run-(\d+)", entity_label)
    if run:
        same_run = sorted(directory.glob(f"*_run-{run.group(1)}_*_decomp.npz"))
        if same_run:
            return same_run[0]
    edited = directory / f"{entity_label}_edited.npz"
    return edited if edited.exists() else None


def load_paired_from_path(file_path: Path) -> dict[str, Any]:
    """Resolve and load a paired decomp/log set from a selected file path."""
    if not file_path.name:
        raise MureplayError("Choose a file to open.", field="file_path")
    if not file_path.exists():
        raise NotFoundError(f"File not found: {file_path}.", field="file_path")

    entity_label = _entity_label_from_filename(file_path.name)
    if not entity_label:
        raise MureplayError(
            f"Cannot tell the recording from the file name {file_path.name}.", field="file_path"
        )

    directory = file_path.parent
    decomp_path = _find_decomposition(directory, entity_label)
    if decomp_path is None:
        raise NotFoundError(
            f"No decomp NPZ found for '{entity_label}' in {directory}.", field="file_path"
        )
    edit_log_path = directory / f"{entity_label}_edited.json"
    if not edit_log_path.exists():
        raise NotFoundError(
            f"No paired edited JSON found for '{entity_label}' in {directory}.", field="file_path"
        )

    payload = _load_npz_payload(decomp_path)
    _merge_edit_log(payload, edit_log_path)
    payload["source_filename"] = decomp_path.name
    payload["bids_root"] = _infer_bids_root(file_path) or str(data_root())
    # The decomposition's own label: the recording its EMG comes from.
    payload["entity_label"] = _entity_label_from_filename(decomp_path.name)
    return payload
