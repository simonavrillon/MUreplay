"""HTTP smoke tier: FastAPI ``TestClient`` pass over the live MUreplay endpoints."""

from __future__ import annotations

import re
from pathlib import Path

from fastapi.testclient import TestClient

from mureplay.api.app_factory import create_app, mount_frontend
from mureplay.api.routes import include_routers
from mureplay.cli import LOOPBACK_HOSTS
from mureplay.paths import frontend_dir

REPO_ROOT = Path(__file__).resolve().parents[1]


def make_client() -> TestClient:
    app = create_app()
    include_routers(app)
    return TestClient(app)


def test_health() -> None:
    response = make_client().get("/api/v1/health")
    assert response.status_code == 200
    body = response.json()
    assert body["data"]["status"] == "ok"


def test_config_returns_bids_root() -> None:
    response = make_client().get("/api/v1/config")
    assert response.status_code == 200
    body = response.json()
    assert isinstance(body["data"]["bids_root"], str)
    assert body["data"]["bids_root"]


def test_load_paired_from_path_missing_file_is_a_clean_error() -> None:
    response = make_client().post(
        "/api/v1/load-paired-from-path",
        json={"file_path": "/nonexistent/entity_edited.npz"},
    )
    assert response.status_code == 404
    error = response.json()["error"]
    assert error["code"] == "not_found"
    # The path the user picked has to survive into the message, or the UI can
    # only say that something went wrong. The service reports it in the
    # platform's native separator style.
    assert str(Path("/nonexistent/entity_edited.npz")) in error["message"]


def test_rejected_payload_is_a_400_naming_the_reason() -> None:
    response = make_client().post(
        "/api/v1/edit/update-filter",
        json={
            "bids_root": "/bids",
            "entity_label": "sub-1",
            "distimes": [[1, 2]],
            "mu_index": 99,
            "view_start": 0,
            "view_end": 100,
        },
    )
    assert response.status_code == 400
    error = response.json()["error"]
    assert error["code"] == "bad_request"
    assert error["message"] == "MU index is out of range."


def test_schema_violation_still_returns_the_validation_envelope() -> None:
    response = make_client().post(
        "/api/v1/edit/update-filter",
        json={"bids_root": "/bids", "entity_label": "sub-1", "mu_index": "not-an-int"},
    )
    assert response.status_code == 422
    assert response.json()["error"]["code"] == "validation_error"


def test_unknown_route_still_returns_the_http_envelope() -> None:
    response = make_client().get("/api/v1/no-such-endpoint")
    assert response.status_code == 404
    assert response.json()["error"]["code"] == "http_404"


def test_frontend_routes_are_all_served() -> None:
    js = (REPO_ROOT / "frontend" / "src" / "api" / "routes.js").read_text(encoding="utf-8")
    paths = set(re.findall(r':\s*"(/[^"]+)"', js))
    assert paths, "no routes parsed from routes.js"
    served = set(make_client().app.openapi()["paths"])  # type: ignore[attr-defined]
    assert {f"/api/v1{p}" for p in paths} <= served


def test_page_and_api_share_one_origin() -> None:
    folder = frontend_dir()
    assert folder is not None
    app = create_app()
    include_routers(app)
    mount_frontend(app, folder)
    client = TestClient(app)

    page = client.get("/")
    assert page.status_code == 200
    assert "<html" in page.text.lower()
    assert page.headers["cache-control"] == "no-cache"
    assert client.get("/api/v1/health").status_code == 200


def test_loopback_server_rejects_other_hosts() -> None:
    app = create_app(allowed_hosts=LOOPBACK_HOSTS)
    include_routers(app)
    client = TestClient(app, base_url="http://127.0.0.1")
    assert client.get("/api/v1/health").status_code == 200
    assert client.get("/api/v1/health", headers={"host": "evil.example"}).status_code == 400
