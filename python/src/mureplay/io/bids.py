"""BIDS EMG path resolution, channels.tsv parsing, and pyedflib reading."""

from __future__ import annotations

import csv
import json
from pathlib import Path
from typing import Any

import numpy as np
import pyedflib

from mureplay.errors import MureplayError, NotFoundError


def parse_entity_label(entity_label: str) -> tuple[str, str | None]:
    """The subject and session of a BIDS entity label such as ``sub-1_ses-1_task-x``."""
    subject = None
    session = None
    for part in str(entity_label).split("_"):
        if part.startswith("sub-"):
            subject = part.replace("sub-", "", 1)
        elif part.startswith("ses-"):
            session = part.replace("ses-", "", 1)
    if not subject:
        raise MureplayError(
            f"The file name {entity_label!r} names no BIDS subject (sub-<label>).",
            field="entity_label",
        )
    return subject, session


def resolve_bids_emg_path(bids_root: Path, entity_label: str) -> Path:
    """The ``.bdf``/``.edf`` recording of ``entity_label`` under ``bids_root``."""
    subject, session = parse_entity_label(entity_label)
    base_dir = bids_root / f"sub-{subject}"
    if session:
        base_dir = base_dir / f"ses-{session}"
    emg_dir = base_dir / "emg"
    for ext in (".bdf", ".edf"):
        candidate = emg_dir / f"{entity_label}_emg{ext}"
        if candidate.exists():
            return candidate
    raise NotFoundError(
        f"No EMG recording for {entity_label} in {emg_dir}; set MUREPLAY_DATA_ROOT to the dataset.",
        field="bids_root",
    )


def resolve_bids_channels_tsv(emg_path: Path, entity_label: str) -> Path:
    """The ``channels.tsv`` beside the recording."""
    for name in (f"{entity_label}_channels.tsv", f"{entity_label}_emg_channels.tsv"):
        candidate = emg_path.with_name(name)
        if candidate.exists():
            return candidate
    raise NotFoundError(
        f"No channels.tsv for {entity_label} in {emg_path.parent}.", field="bids_root"
    )


def select_grid_channels(channels_tsv: Path, grid_index: int) -> tuple[list[int], np.ndarray]:
    """The recording rows of grid ``grid_index`` and their bad-channel mask, from ``channels.tsv``."""
    channel_indices: list[int] = []
    bad_mask: list[int] = []
    target = f"Grid{grid_index + 1}"
    with channels_tsv.open("r", encoding="utf-8") as f:
        reader = csv.DictReader(f, delimiter="\t")
        for idx, row in enumerate(reader):
            if row.get("type") != "EMG":
                continue
            if row.get("group") != target:
                continue
            channel_indices.append(idx)
            status = (row.get("status") or "").lower()
            bad_mask.append(1 if status == "bad" else 0)
    if not channel_indices:
        raise MureplayError(f"No EMG channels for {target} in {channels_tsv}.", field="grid_index")
    return channel_indices, np.asarray(bad_mask, dtype=int)


def _declared_sample_count(sidecar: dict[str, Any], fsamp: float) -> int | None:
    """Sample count implied by the sidecar's ``RecordingDuration``, when usable."""
    # EDF/BDF stores whole data records, so the writer zero-pads the last one;
    # RecordingDuration is the only record of where the signal really ends. Reading
    # past it changes the whole-signal notch and bandpass, as in MUedit2's reader.
    duration = sidecar.get("RecordingDuration")
    if duration is None or fsamp <= 0:
        return None
    try:
        n_samples = int(round(float(duration) * fsamp))
    except (TypeError, ValueError):
        return None
    return n_samples if n_samples > 0 else None


def _read_sidecar(emg_path: Path, entity_label: str) -> dict[str, Any]:
    """Load the ``*_emg.json`` sidecar beside a recording, or ``{}`` if absent."""
    json_path = emg_path.parent / f"{entity_label}_emg.json"
    if not json_path.exists():
        return {}
    with json_path.open("r", encoding="utf-8") as f:
        sidecar = json.load(f)
    return sidecar if isinstance(sidecar, dict) else {}


def load_bids_emg_grid(
    bids_root: Path,
    entity_label: str,
    grid_index: int,
    read_start: int = 0,
    read_n: int | None = None,
) -> tuple[np.ndarray, float, np.ndarray]:
    """One grid's float32 rows, sampling rate and bad-channel mask, read from the BIDS recording."""
    emg_path = resolve_bids_emg_path(bids_root, entity_label)
    channels_tsv = resolve_bids_channels_tsv(emg_path, entity_label)
    channel_indices, bad_mask = select_grid_channels(channels_tsv, grid_index)

    reader = pyedflib.EdfReader(str(emg_path))
    try:
        fsamp = float(reader.getSampleFrequency(channel_indices[0]))
        n_stored = min(int(reader.getNSamples()[ch]) for ch in channel_indices)
        declared = _declared_sample_count(_read_sidecar(emg_path, entity_label), fsamp)
        n_available = n_stored if declared is None else min(n_stored, declared)
        start = max(0, min(read_start, n_available))
        n = n_available - start if read_n is None else max(0, min(read_n, n_available - start))
        signals = [reader.readSignal(ch_idx, start=start, n=n) for ch_idx in channel_indices]
        data = np.vstack(signals).astype(np.float32) if signals else np.zeros((0, 0), np.float32)
    finally:
        reader.close()
    return data, fsamp, bad_mask
