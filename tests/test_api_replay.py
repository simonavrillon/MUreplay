"""The load route: a chosen file becomes the paired decomposition and edit log."""

from __future__ import annotations

from pathlib import Path

from starlette.testclient import TestClient

from tests._api import API, error, ok
from tests.conftest import SAMPLE_ENTITY

# ── Load ────────────────────────────────────────────────────────────────────


class TestLoadPairedFromPath:
    def test_a_missing_file_is_a_404_naming_it(self, client: TestClient) -> None:
        missing = Path("/nonexistent/entity_edited.npz")
        resp = client.post(f"{API}/load-paired-from-path", json={"file_path": str(missing)})
        err = error(resp, 404)
        # The page can only say what went wrong if the path survives into the message.
        assert str(missing) in err["message"]
        assert err["detail"] == {"field": "file_path"}

    def test_the_sample_session_loads(self, client: TestClient, sample_bids_root: Path) -> None:
        path = (
            sample_bids_root
            / "derivatives"
            / "muedit"
            / "sub-1"
            / "ses-1"
            / "decomp"
            / f"{SAMPLE_ENTITY}_edited.npz"
        )
        data = ok(client.post(f"{API}/load-paired-from-path", json={"file_path": str(path)}))
        assert data["entity_label"] == SAMPLE_ENTITY
        assert data["edit_history"]
