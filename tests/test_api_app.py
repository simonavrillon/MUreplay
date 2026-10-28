"""The app as served: one origin for page and API, the host check, and the response envelopes."""

from __future__ import annotations

import re

from starlette.testclient import TestClient

from mureplay.api.app_factory import create_app, mount_frontend
from mureplay.api.routes import include_routers
from mureplay.cli import _LOOPBACK_HOSTS
from mureplay.paths import frontend_dir
from tests._api import API, error
from tests.conftest import REPO_ROOT

# ── Serving ─────────────────────────────────────────────────────────────────


class TestServing:
    def test_page_and_api_share_one_origin(self) -> None:
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
        missing = client.post(f"{API}/load-paired-from-path", json={"file_path": "/no/such.npz"})
        error(missing, 404)

    def test_a_loopback_server_rejects_other_hosts(self) -> None:
        app = create_app(allowed_hosts=_LOOPBACK_HOSTS)
        include_routers(app)
        client = TestClient(app, base_url="http://127.0.0.1")
        load = f"{API}/load-paired-from-path"
        body = {"file_path": "/no/such.npz"}
        assert client.post(load, json=body).status_code == 404
        assert client.post(load, json=body, headers={"host": "evil.example"}).status_code == 400

    def test_every_path_in_routes_js_is_served(self, client: TestClient) -> None:
        js = (REPO_ROOT / "frontend" / "src" / "api" / "routes.js").read_text(encoding="utf-8")
        paths = set(re.findall(r':\s*"(/[^"]+)"', js))
        assert paths, "no routes parsed from routes.js"
        served = set(client.app.openapi()["paths"])  # type: ignore[attr-defined]
        assert {f"{API}{p}" for p in paths} <= served


# ── Envelopes ───────────────────────────────────────────────────────────────


class TestEnvelopes:
    def test_unknown_route_uses_the_error_envelope(self, client: TestClient) -> None:
        assert error(client.get(f"{API}/no-such-endpoint"), 404)["message"] == "Not Found"

    def test_a_schema_violation_uses_the_validation_envelope(self, client: TestClient) -> None:
        resp = client.post(
            f"{API}/edit/update-filter",
            json={"bids_root": "/bids", "entity_label": "sub-1", "mu": "not-an-int"},
        )
        error(resp, 422, "validation_error")

    def test_a_bug_is_a_generic_500_that_leaks_nothing(self) -> None:
        app = create_app()

        @app.get("/boom")
        def boom() -> None:
            raise KeyError("internal detail")

        resp = TestClient(app, raise_server_exceptions=False).get("/boom")
        assert error(resp, 500, "internal_error") == {
            "code": "internal_error",
            "message": "Internal server error",
        }
