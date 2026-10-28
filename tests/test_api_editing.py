"""The update-filter route and the service that refits one MU on the BIDS EMG."""

from __future__ import annotations

from pathlib import Path
from typing import Any

import pytest
from starlette.testclient import TestClient

from mureplay.api.services.filter_service import grid_emg_type
from tests._api import API, error


def _step(**fields: Any) -> dict[str, Any]:
    """An update-filter request with the fields the tests vary."""
    return {
        "bids_root": "/bids",
        "entity_label": "sub-1",
        "spike_times": [[100]],
        "mu": 0,
        "mu_grid_index": [0],
        "view_start": 0,
        "view_end": 100,
        **fields,
    }


# ── Rejected requests ───────────────────────────────────────────────────────


class TestRejectedRequests:
    def test_an_unknown_mu_is_a_400_naming_the_field(self, client: TestClient) -> None:
        err = error(client.post(f"{API}/edit/update-filter", json=_step(mu=99)), 400)
        assert err["message"] == "MU index is out of range."
        assert err["detail"] == {"field": "mu"}

    def test_a_short_grid_index_is_a_400_naming_the_field(self, client: TestClient) -> None:
        resp = client.post(f"{API}/edit/update-filter", json=_step(mu_grid_index=[]))
        assert error(resp, 400)["detail"] == {"field": "mu_grid_index"}

    def test_a_missing_recording_is_a_404_naming_the_dataset(
        self, client: TestClient, tmp_path: Path
    ) -> None:
        resp = client.post(
            f"{API}/edit/update-filter",
            json=_step(bids_root=str(tmp_path), entity_label="sub-1_task-x"),
        )
        assert error(resp, 404)["detail"] == {"field": "bids_root"}


# ── Service ─────────────────────────────────────────────────────────────────


class TestGridEmgType:
    @pytest.mark.parametrize(
        ("grid_name", "expected"),
        [("HD08MM1305", 1), ("Grid 3 MYOMRF-4x8", 2), ("MYOMNP-1x32", 2), ("", 1)],
    )
    def test_intramuscular_grids_take_the_wide_band(self, grid_name: str, expected: int) -> None:
        assert grid_emg_type(grid_name) == expected
