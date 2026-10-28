"""BIDS EMG reading for the refit: one grid of a recording, as MUedit2's reader picks it."""

from __future__ import annotations

import csv
import json
import re
from pathlib import Path
from typing import Any

import numpy as np
import pyedflib

from mureplay.errors import MureplayError, NotFoundError

_GRID_LABEL = re.compile(r"^grid\s*(\d+)$", re.IGNORECASE)


def _entity_pairs(stem: str) -> dict[str, str]:
    """The ``key-value`` entities of a BIDS file stem."""
    return dict(part.split("-", 1) for part in stem.split("_") if "-" in part)


def _resolve_bids_emg_path(bids_root: Path, entity_label: str) -> Path:
    """The ``.bdf``/``.edf`` recording of ``entity_label`` under ``bids_root``."""
    entities = _entity_pairs(entity_label)
    if not entities.get("sub"):
        raise MureplayError(
            f"The file name {entity_label!r} names no BIDS subject (sub-<label>).",
            field="entity_label",
        )
    emg_dir = bids_root / f"sub-{entities['sub']}"
    if entities.get("ses"):
        emg_dir = emg_dir / f"ses-{entities['ses']}"
    emg_dir = emg_dir / "emg"
    for ext in (".bdf", ".edf"):
        candidate = emg_dir / f"{entity_label}_emg{ext}"
        if candidate.exists():
            return candidate
    raise NotFoundError(
        f"No EMG recording for {entity_label} in {emg_dir}; set MUREPLAY_DATA_ROOT to the dataset.",
        field="bids_root",
    )


def _resolve_bids_channels_tsv(emg_path: Path, entity_label: str) -> Path:
    """The ``channels.tsv`` beside the recording."""
    for name in (f"{entity_label}_channels.tsv", f"{entity_label}_emg_channels.tsv"):
        candidate = emg_path.with_name(name)
        if candidate.exists():
            return candidate
    raise NotFoundError(
        f"No channels.tsv for {entity_label} in {emg_path.parent}.", field="bids_root"
    )


def _blank(value: str | None) -> bool:
    """Whether a TSV cell is empty or ``n/a``."""
    return (value or "").strip().lower() in ("", "n/a")


def _grid_number(label: str) -> int | None:
    """``n`` for a ``Grid<n>`` label, else ``None``."""
    match = _GRID_LABEL.match(label.strip())
    return int(match[1]) if match else None


def _grid_rows(rows: list[dict[str, str]]) -> list[list[int]]:
    """The ``channels.tsv`` rows of each grid, in grid order, as MUedit2 groups them."""
    # An EMG row with a group belongs to a grid; groups sort by number when all are
    # Grid<n>, else keep the order they are first listed in.
    groups: dict[str, list[int]] = {}
    for idx, row in enumerate(rows):
        if (row.get("type") or "").strip().upper() == "EMG" and not _blank(row.get("group")):
            groups.setdefault(row["group"].strip(), []).append(idx)
    labels = list(groups)
    if all(_grid_number(label) is not None for label in labels):
        labels.sort(key=lambda label: _grid_number(label) or 0)
    return [groups[label] for label in labels]


def _inherited(bids_root: Path, emg_path: Path, entity_label: str, suffix: str) -> list[Path]:
    """Files named ``…_<suffix>`` whose entities all match the recording's, least specific first."""
    wanted = _entity_pairs(entity_label)
    folders = [bids_root]
    if "sub" in wanted:
        folders.append(bids_root / f"sub-{wanted['sub']}")
        if "ses" in wanted:
            folders.append(folders[-1] / f"ses-{wanted['ses']}")
    folders.append(emg_path.parent)
    found: list[tuple[int, int, Path]] = []
    for level, folder in enumerate(dict.fromkeys(folders)):
        for path in folder.glob(f"*{suffix}"):
            if path.name != suffix and not path.name.endswith(f"_{suffix}"):
                continue
            entities = _entity_pairs(path.name[: -len(suffix)].rstrip("_"))
            if all(wanted.get(k) == v for k, v in entities.items()):
                found.append((level, len(entities), path))
    return [path for *_, path in sorted(found)]


def _read_sidecar(bids_root: Path, emg_path: Path, entity_label: str) -> dict[str, Any]:
    """The recording's ``*_emg.json`` merged over the sidecars it inherits, or ``{}``."""
    merged: dict[str, Any] = {}
    for path in _inherited(bids_root, emg_path, entity_label, "emg.json"):
        try:
            sidecar = json.loads(path.read_text(encoding="utf-8"))
        except json.JSONDecodeError as exc:
            raise MureplayError(
                f"{path.name} is not valid JSON; fix or remove it, then replay again.",
                field="bids_root",
            ) from exc
        if isinstance(sidecar, dict):
            merged.update(sidecar)
    return merged


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


def _signal_index(edf_reader: Any, rows: list[dict[str, str]]) -> list[int]:
    """EDF signal of each channels.tsv row: matched by label, by position when labels do not match."""
    labels = {str(label).strip(): i for i, label in enumerate(edf_reader.getSignalLabels())}
    names = [(row.get("name") or "").strip() for row in rows]
    if len(set(names)) == len(names) and all(name in labels for name in names):
        return [labels[name] for name in names]
    return list(range(len(rows)))


def read_bids_emg_grid(
    bids_root: Path, entity_label: str, grid: int
) -> tuple[np.ndarray, float, np.ndarray]:
    """One grid over the whole recording as float32 rows, with its sampling rate and discard mask."""
    emg_path = _resolve_bids_emg_path(bids_root, entity_label)
    channels_tsv = _resolve_bids_channels_tsv(emg_path, entity_label)
    with channels_tsv.open("r", encoding="utf-8") as f:
        # BIDS TSV has no quoting: a cell starting with '"' is plain text.
        rows = list(csv.DictReader(f, delimiter="\t", quoting=csv.QUOTE_NONE))
    grids = _grid_rows(rows)
    if not 0 <= grid < len(grids):
        raise MureplayError(f"No EMG grid {grid + 1} in {channels_tsv}.", field="mu_grid_index")
    layout = grids[grid]
    statuses = ((rows[r].get("status") or "").strip().lower() for r in layout)
    discard_mask = np.array([1 if s == "bad" else 0 for s in statuses], dtype=int)

    reader = pyedflib.EdfReader(str(emg_path))
    try:
        index = _signal_index(reader, rows)
        channels = [index[r] for r in layout]
        fsamp = float(reader.getSampleFrequency(channels[0]))
        n = min(int(reader.getNSamples()[ch]) for ch in channels)
        declared = _declared_sample_count(_read_sidecar(bids_root, emg_path, entity_label), fsamp)
        n = n if declared is None else min(n, declared)
        data = np.empty((len(channels), n), dtype=np.float32)
        for row, ch in enumerate(channels):
            data[row] = reader.readSignal(ch, start=0, n=n)
    finally:
        reader.close()
    return data, fsamp, discard_mask
