"""IO tests against a real MUedit2 BIDS output (local ``data/`` folder).

The sample dataset is a full MUedit2 session export: raw EMG (``.bdf`` +
``_channels.tsv``) under ``<root>/sub-*/ses-*/emg/`` and the decomposition
derivative (``_decomp.npz`` + ``_edited.json``) under
``<root>/derivatives/muedit/sub-*/ses-*/decomp/``.

``data/`` is gitignored, so these tests skip automatically on machines where
the sample dataset has not been copied in.
"""

from __future__ import annotations

from pathlib import Path
from typing import Any

import numpy as np
import pytest

from mureplay.api.services.filter_service import run_update_filter
from mureplay.io.bids import load_bids_emg_grid
from mureplay.io.loaders import load_paired_from_path

DATA_ROOT = Path(__file__).resolve().parents[1] / "data"
BIDS_ROOT = DATA_ROOT / "Test"
DECOMP_DIR = BIDS_ROOT / "derivatives" / "muedit" / "sub-1" / "ses-1" / "decomp"
ENTITY = "sub-1_ses-1_task-triangle_run-1"

pytestmark = pytest.mark.skipif(
    not (DECOMP_DIR / f"{ENTITY}_decomp.npz").is_file(),
    reason="local sample dataset not present (data/ is gitignored)",
)


def _load_payload(npz_name: str) -> dict[str, Any]:
    return load_paired_from_path(DECOMP_DIR / npz_name)


def test_paired_load_from_edited_npz() -> None:
    payload = _load_payload(f"{ENTITY}_edited.npz")

    assert payload["source_kind"] == "decomp_paired"
    assert payload["source_filename"] == f"{ENTITY}_decomp.npz"
    assert payload["entity_label"] == ENTITY
    assert payload["bids_root"] == str(BIDS_ROOT)

    paired = payload["paired_files"]
    assert Path(paired["decomp_npz"]).is_file()
    assert Path(paired["edited_json"]).is_file()

    # The decomp NPZ holds 62 MUs; the sidecar lists 59 because three MUs were
    # removed (remove_duplicates / remove_flagged) after the decomposition was
    # saved. MUreplay must surface both: full arrays plus the surviving ids.
    mu_count = len(payload["discharge_times"])
    assert mu_count == 62
    assert len(payload["pulse_trains"]) == mu_count
    assert len(payload["mu_grid_index"]) == mu_count
    assert len(payload["mu_uids"]) == 59
    assert payload["mu_uids"][0] == "g0_mu0"
    assert payload["fsamp"] == pytest.approx(2000.0)

    history = payload["edit_history"]
    assert isinstance(history, list) and len(history) == 200
    assert {"add_spikes", "delete_spikes", "update_filter", "flag_mu"} <= {
        str(step.get("type")) for step in history
    }


def test_paired_load_from_decomp_npz_matches_edited_entry_point() -> None:
    via_decomp = _load_payload(f"{ENTITY}_decomp.npz")
    via_edited = _load_payload(f"{ENTITY}_edited.npz")

    assert via_decomp["paired_files"] == via_edited["paired_files"]
    assert via_decomp["edit_history"] == via_edited["edit_history"]
    assert via_decomp["mu_uids"] == via_edited["mu_uids"]


def test_paired_load_for_both_subjects() -> None:
    # sub-1 carries a 200-step edit history; sub-2 is an unedited session
    # (empty history) and must still load cleanly.
    subject_dirs = sorted((BIDS_ROOT / "derivatives" / "muedit").glob("sub-*"))
    assert len(subject_dirs) == 2
    for subject_dir in subject_dirs:
        decomp_dir = subject_dir / "ses-1" / "decomp"
        edited_npz = sorted(decomp_dir.glob("*_edited.npz"))
        assert edited_npz, f"no edited NPZ under {decomp_dir}"
        payload = load_paired_from_path(edited_npz[0])
        assert payload["discharge_times"]
        assert payload["mu_uids"]
        assert "edit_history" in payload


def test_load_bids_emg_grid_reads_real_recording() -> None:
    window_n = 4096
    data, fsamp, bad_mask = load_bids_emg_grid(
        BIDS_ROOT, ENTITY, grid_index=0, read_start=0, read_n=window_n
    )

    assert data.ndim == 2
    assert data.shape[1] == window_n
    assert data.shape[0] == bad_mask.shape[0]
    assert fsamp == pytest.approx(2000.0)
    assert bool(np.isfinite(data).all())


def test_update_filter_replays_real_step() -> None:
    payload = _load_payload(f"{ENTITY}_edited.npz")
    step = next(s for s in payload["edit_history"] if s.get("type") == "update_filter")
    mu_uid = str(step["mu_uid"])
    mu_index = payload["mu_uids"].index(mu_uid)

    view_start = int(step["view_start"])
    view_end = min(int(step["view_end"]), view_start + 10000)

    result = run_update_filter(
        {
            "bids_root": str(BIDS_ROOT),
            "entity_label": ENTITY,
            "mu_index": mu_index,
            "distimes": payload["discharge_times"],
            "pulse_train": payload["pulse_trains"][mu_index],
            "grid_index": int(payload["mu_grid_index"][mu_index]),
            "mu_grid_index": payload["mu_grid_index"],
            "view_start": view_start,
            "view_end": view_end,
            "nbextchan": 1000,
            "use_peeloff": bool(step.get("use_peeloff", False)),
            "lock_spikes": bool(step.get("lock_spikes", False)),
            "artifact_times": [],
        }
    )

    assert result["fsamp"] == pytest.approx(2000.0)
    updated = result["distimes"]
    assert isinstance(updated, list)
    assert all(int(t) >= 0 for t in updated)
