"""BIDS EMG path resolution, channels.tsv parsing, and pyedflib reading."""

from __future__ import annotations

import csv
import json
from pathlib import Path

import numpy as np


def parse_entity_label(entity_label: str) -> tuple[str, str | None]:
    subject = None
    session = None
    for part in str(entity_label).split("_"):
        if part.startswith("sub-"):
            subject = part.replace("sub-", "", 1)
        elif part.startswith("ses-"):
            session = part.replace("ses-", "", 1)
    if not subject:
        raise ValueError("Unable to parse subject from entity label.")
    return subject, session


def resolve_bids_emg_path(bids_root: Path, entity_label: str) -> Path:
    subject, session = parse_entity_label(entity_label)
    base_dir = bids_root / f"sub-{subject}"
    if session:
        base_dir = base_dir / f"ses-{session}"
    emg_dir = base_dir / "emg"
    for ext in (".bdf", ".edf"):
        candidate = emg_dir / f"{entity_label}_emg{ext}"
        if candidate.exists():
            return candidate
    raise FileNotFoundError(f"Cannot find EMG file for {entity_label} in {emg_dir}.")


def resolve_bids_channels_tsv(emg_path: Path, entity_label: str) -> Path:
    for name in (f"{entity_label}_channels.tsv", f"{entity_label}_emg_channels.tsv"):
        candidate = emg_path.with_name(name)
        if candidate.exists():
            return candidate
    raise FileNotFoundError(f"Cannot find channels TSV for {entity_label}.")


def select_grid_channels(channels_tsv: Path, grid_index: int) -> tuple[list[int], np.ndarray]:
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
        raise ValueError(f"No EMG channels found for {target}.")
    return channel_indices, np.asarray(bad_mask, dtype=int)


def _declared_sample_count(sidecar: dict, fsamp: float) -> int | None:
    """Sample count implied by the sidecar's ``RecordingDuration``, when usable.

    A mirror of MUedit2's reader clamp: EDF/BDF stores whole data records, so
    the writer zero-pads the last one; ``RecordingDuration`` is the only
    record of where the signal really ends. Reading past it changes the
    whole-signal notch and bandpass, which shifts borderline spike detection.
    """
    duration = sidecar.get("RecordingDuration")
    if duration is None or fsamp <= 0:
        return None
    try:
        n_samples = int(round(float(duration) * fsamp))
    except (TypeError, ValueError):
        return None
    return n_samples if n_samples > 0 else None


def _read_sidecar(emg_path: Path, entity_label: str) -> dict:
    """Load the ``*_emg.json`` sidecar beside a recording, or ``{}`` if absent."""
    json_path = emg_path.parent / f"{entity_label}_emg.json"
    if not json_path.exists():
        return {}
    with json_path.open("r", encoding="utf-8") as f:
        return json.load(f)


def load_bids_emg_grid(
    bids_root: Path,
    entity_label: str,
    grid_index: int,
    read_start: int = 0,
    read_n: int | None = None,
) -> tuple[np.ndarray, float, np.ndarray]:
    try:
        import pyedflib
    except Exception as exc:
        raise RuntimeError(f"pyedflib import failed: {exc}.") from exc

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
