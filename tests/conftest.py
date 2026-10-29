"""Shared fixtures for the test suite."""

from __future__ import annotations

import json
import os
import shutil
import tempfile
from collections.abc import Iterator
from pathlib import Path

import numpy as np
import pytest
from starlette.testclient import TestClient

from mureplay import paths, storage
from mureplay.api.app_factory import create_app
from mureplay.api.routes import include_routers

REPO_ROOT = Path(__file__).resolve().parents[1]
DATA_DIR = REPO_ROOT / "data"
#: The MUedit2 checkout the parity tests compare against.
MUEDIT2_ROOT = Path(os.environ.get("MUEDIT2_ROOT") or (REPO_ROOT.parent / "MUedit2"))
#: The sample session's recording, as both repos' data/Test hold it.
SAMPLE_ENTITY = "sub-1_ses-1_task-triangle_run-1"
_SAMPLE_DECOMP = Path("derivatives", "muedit", "sub-1", "ses-1", "decomp")

#: Fixtures that resolve git-ignored sample files.  A test whose fixture
#: closure reaches any of these is given the ``data`` marker.
DATA_FIXTURES = frozenset({"sample_bids_root", "muedit2_session"})


def require_sample(path: Path) -> Path:
    """``path``, or skip the test when it is missing (fail under ``MUREPLAY_REQUIRE_DATA``)."""
    if not path.exists():
        message = f"sample data file not present: {path}"
        if os.environ.get("MUREPLAY_REQUIRE_DATA"):
            pytest.fail(message)
        pytest.skip(message)
    return path


def pytest_configure(config: pytest.Config) -> None:
    """Keep session stores in a throwaway folder, not the user's cache."""
    if not os.environ.get(paths.CACHE_DIR_ENV):
        folder = tempfile.mkdtemp(prefix="mureplay-test-cache-")
        os.environ[paths.CACHE_DIR_ENV] = folder
        config.add_cleanup(lambda: shutil.rmtree(folder, ignore_errors=True))


def pytest_collection_modifyitems(items: list[pytest.Item]) -> None:
    for item in items:
        if DATA_FIXTURES.intersection(getattr(item, "fixturenames", ())):
            item.add_marker(pytest.mark.data)


@pytest.fixture(scope="session")
def sample_bids_root() -> Path:
    """The local sample BIDS dataset (data/Test): raw EMG plus MUedit2's edited session."""
    root = DATA_DIR / "Test"
    require_sample(root / _SAMPLE_DECOMP / f"{SAMPLE_ENTITY}_decomp.npz")
    return root


@pytest.fixture(scope="session")
def muedit2_session() -> Path:
    """MUedit2's sample session: the edited ``.npz`` its edit log was saved with."""
    return require_sample(
        MUEDIT2_ROOT / "data" / "Test" / _SAMPLE_DECOMP / f"{SAMPLE_ENTITY}_edited.npz"
    )


@pytest.fixture(autouse=True)
def config_file(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Path:
    """A config file of the test's own, so no test reads or writes the user's."""
    path = tmp_path / "config" / "config.json"
    monkeypatch.setattr(paths, "config_file", lambda: path)
    return path


#: The synthetic trial's recording, and the steps its edit log holds.
TRIAL_ENTITY = "sub-1_task-x_run-1"
TRIAL_SAMPLES = 4000
TRIAL_HISTORY = [
    {"type": "add_spikes", "mu_uid": "g0_mu0", "spikes_added": [400]},
    {"type": "update_filter", "mu_uid": "g0_mu0", "view_start": 0, "view_end": 2000},
    {"type": "delete_spikes", "mu_uid": "g0_mu1", "spikes_removed": [150]},
    {"type": "add_artifact", "mu_uid": "g0_mu1", "artifacts_added": [900]},
]


@pytest.fixture
def replay_trial(tmp_path: Path) -> Path:
    """A decomposition of two MUs and its edit log, with no BIDS EMG beside them: the log's path."""
    np.savez(
        tmp_path / f"{TRIAL_ENTITY}_decomp.npz",
        schema_version=np.int64(2),
        fsamp=np.float64(2000.0),
        total_samples=np.int64(TRIAL_SAMPLES),
        spike_times=np.asarray([100, 200, 300, 150, 250], dtype=np.int32),
        spike_offsets=np.asarray([0, 3, 5], dtype=np.int64),
        mu_grid_index=np.asarray([0, 0], dtype=np.int16),
        grid_names=np.array(json.dumps(["Grid 1"])),
        parameters=np.array(json.dumps({})),
        pulse_trains=np.tile(np.linspace(0, 1, TRIAL_SAMPLES, dtype=np.float32), (2, 1)),
    )
    log = tmp_path / f"{TRIAL_ENTITY}_edited.json"
    log.write_text(
        json.dumps({"mu_uids": ["g0_mu0", "g0_mu1"], "history": TRIAL_HISTORY}),
        encoding="utf-8",
    )
    return log


@pytest.fixture
def cache_dir(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Path:
    """A per-test cache folder for session stores, with the default disk reserve."""
    folder = tmp_path / "cache"
    monkeypatch.setenv(paths.CACHE_DIR_ENV, str(folder))
    monkeypatch.delenv(storage.DISK_RESERVE_ENV, raising=False)
    return folder


@pytest.fixture
def client() -> Iterator[TestClient]:
    """The app as ``cli._serve_api`` builds it, without the page."""
    app = create_app()
    include_routers(app)
    with TestClient(app, raise_server_exceptions=False) as test_client:
        yield test_client
