from __future__ import annotations

import json
from pathlib import Path
from typing import Any

import numpy as np


def generate_mu_uids(mu_grid_index: list[int]) -> list[str]:
    counts: dict[int, int] = {}
    uids: list[str] = []
    for grid_idx in mu_grid_index:
        count = counts.get(grid_idx, 0)
        uids.append(f"g{grid_idx}_mu{count}")
        counts[grid_idx] = count + 1
    return uids


def save_npz(
    out_path: Path,
    pulse_trains: np.ndarray,
    distimes: list[list[int]],
    fsamp: float,
    grid_names: list[str],
    mu_grid_index: list[int],
    parameters: dict[str, Any],
    total_samples: int,
) -> None:
    np.savez_compressed(
        out_path,
        pulse_trains=pulse_trains,
        discharge_times=np.array(distimes, dtype=object),
        fsamp=fsamp,
        grid_names=np.array(grid_names, dtype=object),
        mu_grid_index=np.array(mu_grid_index, dtype=int),
        parameters=np.array([parameters], dtype=object),
        total_samples=total_samples,
    )


def save_editlog(
    path: Path,
    mu_uids: list[str],
    history: list[dict[str, Any]],
    artifact_times: list[list[int]] | None = None,
) -> None:
    doc: dict[str, Any] = {"mu_uids": mu_uids, "history": history}
    if artifact_times is not None:
        doc["artifact_times"] = artifact_times
    with path.open("w", encoding="utf-8") as fh:
        json.dump(doc, fh, indent=2)
