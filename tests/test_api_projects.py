"""The project routes: the data folder's BIDS projects, and choosing another data folder."""

from __future__ import annotations

import json
from pathlib import Path

import pytest
from starlette.testclient import TestClient

from mureplay.api.services import dialog_service
from mureplay.paths import DATA_ROOT_ENV
from tests._api import API, error, ok


def _dataset(folder: Path) -> None:
    """Make ``folder`` a BIDS dataset with no recordings."""
    folder.mkdir(parents=True)
    (folder / "dataset_description.json").touch()


def _pick(monkeypatch: pytest.MonkeyPatch, folder: Path | None) -> None:
    """Make the folder dialog answer ``folder`` (None: cancelled)."""
    monkeypatch.setattr(dialog_service, "choose_folder", lambda start: folder)


# ── Projects ────────────────────────────────────────────────────────────────


class TestProjects:
    def test_the_data_folder_is_listed_with_its_projects(
        self, client: TestClient, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        _dataset(tmp_path / "Study")
        monkeypatch.setenv(DATA_ROOT_ENV, str(tmp_path))
        data = ok(client.get(f"{API}/projects"))
        assert data == {"projects": [{"name": "Study", "subjects": []}], "data_root": str(tmp_path)}


# ── Choosing the data folder ────────────────────────────────────────────────


class TestChooseDataFolder:
    def test_the_picked_folder_is_listed_and_remembered(
        self,
        client: TestClient,
        tmp_path: Path,
        config_file: Path,
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        monkeypatch.delenv(DATA_ROOT_ENV, raising=False)
        picked = tmp_path / "lab"
        _dataset(picked / "Study")
        _pick(monkeypatch, picked)
        assert ok(client.post(f"{API}/dialog/data-folder")) == {"data_root": str(picked)}
        assert ok(client.get(f"{API}/projects"))["data_root"] == str(picked)
        assert json.loads(config_file.read_text(encoding="utf-8"))["data_root"] == str(picked)

    def test_a_cancelled_dialog_keeps_the_folder(
        self,
        client: TestClient,
        config_file: Path,
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        monkeypatch.delenv(DATA_ROOT_ENV, raising=False)
        _pick(monkeypatch, None)
        assert ok(client.post(f"{API}/dialog/data-folder")) == {"data_root": None}
        assert not config_file.exists()

    def test_the_env_override_refuses_a_choice(
        self, client: TestClient, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        monkeypatch.setenv(DATA_ROOT_ENV, str(tmp_path))
        _pick(monkeypatch, tmp_path / "other")
        message = error(client.post(f"{API}/dialog/data-folder"), 400)["message"]
        assert DATA_ROOT_ENV in message
