"""The project route: the data folder's BIDS projects, as the settings rail's tree."""

from __future__ import annotations

from pathlib import Path

import pytest
from starlette.testclient import TestClient

from mureplay.paths import DATA_ROOT_ENV
from tests._api import API, ok

# ── Projects ────────────────────────────────────────────────────────────────


class TestProjects:
    def test_the_data_folder_is_listed_with_its_projects(
        self, client: TestClient, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        (tmp_path / "Study").mkdir()
        (tmp_path / "Study" / "dataset_description.json").touch()
        monkeypatch.setenv(DATA_ROOT_ENV, str(tmp_path))
        data = ok(client.get(f"{API}/projects"))
        assert data == {"projects": [{"name": "Study", "subjects": []}], "data_root": str(tmp_path)}
