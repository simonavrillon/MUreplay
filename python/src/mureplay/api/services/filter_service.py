"""Filter service: re-run MUedit2's filter update for one MU."""

from __future__ import annotations

from pathlib import Path
from typing import Any

import numpy as np

from mureplay.api.schemas import UpdateFilterPayload
from mureplay.errors import MureplayError
from mureplay.io.bids import read_bids_emg_grid
from mureplay.replay.artifact_mask import build_manual_artifact_mask
from mureplay.replay.filter_update import (
    edge_samples,
    emg_filter_inplace,
    update_motor_unit_filter_window,
)

#: The intramuscular grids of MUedit2's catalogue (``signal/grid.py``), matched as substrings
#: of the grid name like MUedit2 does; every other grid takes the surface bandpass.
_INTRAMUSCULAR_GRIDS = ("MYOMRF-4x8", "MYOMNP-1x32")


def _grid_emg_type(grid_name: str) -> int:
    """The bandpass MUedit2 filters ``grid_name`` with: 2 for intramuscular, 1 for surface."""
    return 2 if any(key in grid_name for key in _INTRAMUSCULAR_GRIDS) else 1


def run_update_filter(payload: UpdateFilterPayload) -> dict[str, Any]:
    """Refit one MU's filter as MUedit2 does and return its new discharges and pulse train."""
    bids_root = payload.bids_root.strip()
    entity_label = payload.entity_label.strip()
    if not bids_root or not entity_label:
        raise MureplayError(
            "This step needs the BIDS dataset and recording of the session.", field="bids_root"
        )

    # update_motor_unit_filter_window sorts and de-duplicates every train it is given.
    spike_times = payload.spike_times
    mu = payload.mu
    if mu < 0 or mu >= len(spike_times):
        raise MureplayError("MU index is out of range.", field="mu")
    mu_grid_index = payload.mu_grid_index
    if len(mu_grid_index) != len(spike_times):
        raise MureplayError("The step needs the grid of every MU.", field="mu_grid_index")

    grid = mu_grid_index[mu]
    view_start, view_end = payload.view_start, payload.view_end
    if view_end <= view_start:
        raise MureplayError("The step's window ends before it starts.", field="view_end")

    row = np.asarray(payload.pulse_train, dtype=float)
    inactive_mus = set(payload.inactive_mus)
    # MUedit2 peels off the other live MUs of the grid; flagged and removed ones are left out.
    peel_off_spike_times = [
        spike_times[i]
        for i in range(len(spike_times))
        if i != mu and i not in inactive_mus and mu_grid_index[i] == grid
    ]

    emg, fsamp, discard_mask = read_bids_emg_grid(Path(bids_root), entity_label, grid)
    if view_end > emg.shape[1]:
        raise MureplayError(
            "The step's window runs past the end of the EMG recording.", field="view_end"
        )
    emg_filter_inplace(emg, fsamp, _grid_emg_type(payload.grid_name))
    artifact_mask = build_manual_artifact_mask(payload.artifact_regions, emg.shape[1])

    pulse_train, updated = update_motor_unit_filter_window(
        emg,
        discard_mask,
        spike_times[mu],
        fsamp,
        view_start,
        view_end,
        nbextchan=payload.nbextchan,
        peel_off_spike_times=peel_off_spike_times if payload.use_peeloff else None,
        peel_off_win=payload.peel_off_win,
        artifact_times=payload.artifact_times,
        lock_spikes=payload.lock_spikes,
        artifact_mask=artifact_mask,
        compute_dtype=payload.compute_dtype,
    )
    updated_pulse_train = None
    if row.size and pulse_train is not None:
        edge = edge_samples(fsamp)
        seg_start = view_start + edge
        seg_end = min(view_start + len(pulse_train) - edge, row.shape[0])
        if seg_end > seg_start and len(pulse_train) > 2 * edge:
            row[seg_start:seg_end] = pulse_train[edge : edge + (seg_end - seg_start)]
        updated_pulse_train = row.tolist()

    return {
        "spikes": updated.tolist(),
        "pulse_train": updated_pulse_train,
    }
