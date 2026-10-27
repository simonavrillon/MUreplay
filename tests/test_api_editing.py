"""The update-filter route and the service that refits one MU on the BIDS EMG."""

from __future__ import annotations

from pathlib import Path
from typing import Any

import pytest
from starlette.testclient import TestClient

from mureplay.api.services.filter_service import emg_type, run_update_filter
from mureplay.io.loaders import load_paired_from_path
from tests._api import API, error
from tests.conftest import SAMPLE_ENTITY


def _step(**fields: Any) -> dict[str, Any]:
    """An update-filter request with the fields the tests vary."""
    return {
        "bids_root": "/bids",
        "entity_label": "sub-1",
        "distimes": [[100]],
        "mu_index": 0,
        "view_start": 0,
        "view_end": 100,
        **fields,
    }


# ── Rejected requests ───────────────────────────────────────────────────────


class TestRejectedRequests:
    def test_an_unknown_mu_is_a_400_naming_the_field(self, client: TestClient) -> None:
        err = error(client.post(f"{API}/edit/update-filter", json=_step(mu_index=99)), 400)
        assert err["message"] == "MU index is out of range."
        assert err["detail"] == {"field": "mu_index"}

    def test_a_missing_recording_is_a_404_naming_the_dataset(
        self, client: TestClient, tmp_path: Path
    ) -> None:
        resp = client.post(
            f"{API}/edit/update-filter",
            json=_step(bids_root=str(tmp_path), entity_label="sub-1_task-x"),
        )
        assert error(resp, 404)["detail"] == {"field": "bids_root"}

    def test_artifact_regions_reach_the_service(self, client: TestClient) -> None:
        # Without BIDS data the service fails on the missing EMG; a message naming the EMG
        # folder proves the request passed validation with its artifact_regions.
        resp = client.post(
            f"{API}/edit/update-filter",
            json=_step(bids_root="/nonexistent", artifact_regions=[[10, 20]]),
        )
        assert str(Path("/nonexistent") / "sub-1" / "emg") in error(resp, 404)["message"]


# ── Service ─────────────────────────────────────────────────────────────────


class TestEmgType:
    @pytest.mark.parametrize(
        ("grid_name", "expected"),
        [("HD08MM1305", 1), ("Grid 3 MYOMRF-4x8", 2), ("MYOMNP-1x32", 2), ("", 1)],
    )
    def test_intramuscular_grids_take_the_wide_band(self, grid_name: str, expected: int) -> None:
        assert emg_type(grid_name) == expected


class TestRunUpdateFilter:
    def test_a_logged_step_refits_on_the_sample_recording(self, sample_bids_root: Path) -> None:
        decomp = sample_bids_root / "derivatives" / "muedit" / "sub-1" / "ses-1" / "decomp"
        payload = load_paired_from_path(decomp / f"{SAMPLE_ENTITY}_edited.npz")
        step = next(s for s in payload["edit_history"] if s.get("type") == "update_filter")
        mu = payload["mu_uids"].index(step["mu_uid"])
        view_start = int(step["view_start"])

        result = run_update_filter(
            {
                "bids_root": str(sample_bids_root),
                "entity_label": SAMPLE_ENTITY,
                "mu_index": mu,
                "distimes": payload["discharge_times"],
                "pulse_train": payload["pulse_trains"][mu],
                "grid_index": payload["mu_grid_index"][mu],
                "mu_grid_index": payload["mu_grid_index"],
                "view_start": view_start,
                "view_end": min(int(step["view_end"]), view_start + 10000),
                "use_peeloff": bool(step.get("use_peeloff")),
                "lock_spikes": bool(step.get("lock_spikes")),
            }
        )
        assert result["fsamp"] == pytest.approx(2000.0)
        assert result["distimes"] == sorted(set(result["distimes"]))
        assert all(t >= 0 for t in result["distimes"])
