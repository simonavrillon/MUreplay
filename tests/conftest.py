"""Shared fixtures for the test suite."""

from __future__ import annotations

import os
from collections.abc import Iterator
from pathlib import Path

import pytest
from starlette.testclient import TestClient

from mureplay import paths
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


@pytest.fixture
def client() -> Iterator[TestClient]:
    """The app as ``cli._serve_api`` builds it, without the page."""
    app = create_app()
    include_routers(app)
    with TestClient(app, raise_server_exceptions=False) as test_client:
        yield test_client
