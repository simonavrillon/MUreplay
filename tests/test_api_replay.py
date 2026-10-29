"""The replay routes: a chosen file opens a server-side replay session, which the page seeks."""

from __future__ import annotations

from itertools import pairwise
from pathlib import Path
from typing import Any

import numpy as np
from httpx import Response
from starlette.testclient import TestClient

from tests._api import API, error
from tests._frames import unpack_frame
from tests.conftest import SAMPLE_ENTITY, TRIAL_HISTORY


def _frame(resp: Response) -> tuple[dict[str, Any], list[list[int]]]:
    """A 200 MUB1 frame's ``meta``, and its CSR discharge times as rows."""
    assert resp.status_code == 200, resp.text
    meta, arrays = unpack_frame(resp.content)
    offsets, spikes = arrays["spike_offsets"], arrays["spikes"]
    return meta, [spikes[a:b].tolist() for a, b in pairwise(offsets)]


def _open(client: TestClient, path: Path) -> tuple[dict[str, Any], list[list[int]]]:
    return _frame(client.post(f"{API}/replay/session/open", json={"file_path": str(path)}))


def _seek(client: TestClient, token: str, steps: list[int]) -> Response:
    return client.post(f"{API}/replay/seek", json={"token": token, "steps": steps})


# ── Open ────────────────────────────────────────────────────────────────────


class TestOpen:
    def test_a_missing_file_is_a_404_naming_it(self, client: TestClient) -> None:
        missing = Path("/nonexistent/entity_edited.npz")
        resp = client.post(f"{API}/replay/session/open", json={"file_path": str(missing)})
        err = error(resp, 404)
        # The page can only say what went wrong if the path survives into the message.
        assert str(missing) in err["message"]
        assert err["detail"] == {"field": "file_path"}

    def test_the_page_gets_discharges_and_fields_but_no_pulse_trains(
        self, client: TestClient, replay_trial: Path
    ) -> None:
        resp = client.post(f"{API}/replay/session/open", json={"file_path": str(replay_trial)})
        meta, spikes = _frame(resp)
        assert spikes == [[100, 200, 300], [150, 250]]
        assert meta["token"]
        assert meta["total_samples"] == 4000
        assert meta["mu_uids"] == ["g0_mu0", "g0_mu1"]
        assert meta["edit_history"] == TRIAL_HISTORY
        # Only the per-MU fields and the discharges: the pulse trains stay on the server.
        assert len(resp.content) < 4000

    def test_the_sample_session_opens(self, client: TestClient, sample_bids_root: Path) -> None:
        decomp = sample_bids_root / "derivatives" / "muedit" / "sub-1" / "ses-1" / "decomp"
        meta, spikes = _open(client, decomp / f"{SAMPLE_ENTITY}_edited.npz")
        assert meta["entity_label"] == SAMPLE_ENTITY
        assert meta["edit_history"]
        assert len(spikes) == len(meta["mu_uids"]) == 36


# ── Seek ────────────────────────────────────────────────────────────────────


class TestSeek:
    def test_a_step_forward_sends_only_the_mu_it_changed(
        self, client: TestClient, replay_trial: Path
    ) -> None:
        opened, _ = _open(client, replay_trial)
        meta, spikes = _frame(_seek(client, opened["token"], [0]))
        assert meta["changed"] == [0]
        assert spikes == [[100, 200, 300, 400]]
        assert meta["versions"][0] != opened["versions"][0]
        assert meta["versions"][1] == opened["versions"][1]

    def test_seeking_back_restores_the_rows(self, client: TestClient, replay_trial: Path) -> None:
        opened, _ = _open(client, replay_trial)
        _seek(client, opened["token"], [2, 3])
        meta, spikes = _frame(_seek(client, opened["token"], []))
        assert meta["changed"] == [1]
        assert spikes == [[150, 250]]

    def test_a_refit_without_its_emg_falls_back_to_the_log_and_says_why(
        self, client: TestClient, replay_trial: Path
    ) -> None:
        opened, _ = _open(client, replay_trial)
        meta, spikes = _frame(_seek(client, opened["token"], [0, 1]))
        assert [e["step"] for e in meta["refit_errors"]] == [1]
        assert "No EMG recording" in meta["refit_errors"][0]["message"]
        assert spikes == [[100, 200, 300, 400]]

    def test_steps_outside_the_log_are_a_400_naming_the_field(
        self, client: TestClient, replay_trial: Path
    ) -> None:
        opened, _ = _open(client, replay_trial)
        assert error(_seek(client, opened["token"], [9]), 400)["detail"] == {"field": "steps"}

    def test_an_unknown_token_is_a_400_naming_it(self, client: TestClient) -> None:
        assert error(_seek(client, "nope", []), 400)["detail"] == {"field": "token"}

    def test_opening_another_trial_in_the_tab_closes_the_first(
        self, client: TestClient, replay_trial: Path
    ) -> None:
        first, _ = _open(client, replay_trial)
        _open(client, replay_trial)
        assert error(_seek(client, first["token"], []), 400)["detail"] == {"field": "token"}


# ── Prepare a grid ──────────────────────────────────────────────────────────


class TestPrepareGrid:
    def test_a_grid_without_its_emg_is_a_404_naming_the_dataset(
        self, client: TestClient, replay_trial: Path
    ) -> None:
        opened, _ = _open(client, replay_trial)
        resp = client.post(
            f"{API}/replay/session/prepare-grid", json={"token": opened["token"], "grid": 0}
        )
        assert error(resp, 404)["detail"] == {"field": "bids_root"}

    def test_a_grid_no_mu_is_on_needs_no_filtering(
        self, client: TestClient, replay_trial: Path
    ) -> None:
        opened, _ = _open(client, replay_trial)
        resp = client.post(
            f"{API}/replay/session/prepare-grid", json={"token": opened["token"], "grid": 5}
        )
        assert resp.status_code == 204


# ── Pulse windows ───────────────────────────────────────────────────────────


def _pulse(client: TestClient, **params: Any) -> tuple[dict[str, Any], dict[str, np.ndarray]]:
    resp = client.get(f"{API}/series/pulse", params=params)
    assert resp.status_code == 200, resp.text
    return unpack_frame(resp.content)


class TestPulseWindow:
    def test_a_wide_window_is_an_envelope_with_its_discharges(
        self, client: TestClient, replay_trial: Path
    ) -> None:
        opened, _ = _open(client, replay_trial)
        meta, arrays = _pulse(client, token=opened["token"], mu=0, start=0, end=4000, bins=100)
        assert meta["kind"] == "envelope"
        assert arrays["min"].shape == arrays["max"].shape == (1, 100)
        assert arrays["spikes"].tolist() == [100, 200, 300]
        np.testing.assert_allclose(arrays["spike_values"], [100 / 3999, 200 / 3999, 300 / 3999])
        assert meta["version"] == opened["versions"][0]

    def test_a_narrow_window_is_its_samples(self, client: TestClient, replay_trial: Path) -> None:
        opened, _ = _open(client, replay_trial)
        meta, arrays = _pulse(client, token=opened["token"], mu=1, start=140, end=160, bins=100)
        assert meta["kind"] == "samples"
        assert arrays["samples"].shape == (1, 20)
        assert arrays["spikes"].tolist() == [150]

    def test_artifact_markers_follow_the_replay(
        self, client: TestClient, replay_trial: Path
    ) -> None:
        opened, _ = _open(client, replay_trial)
        _seek(client, opened["token"], [3])
        _, arrays = _pulse(client, token=opened["token"], mu=1, bins=100)
        assert arrays["artifacts"].tolist() == [900]

    def test_an_unknown_mu_is_a_400_naming_it(self, client: TestClient, replay_trial: Path) -> None:
        opened, _ = _open(client, replay_trial)
        resp = client.get(f"{API}/series/pulse", params={"token": opened["token"], "mu": 7})
        assert error(resp, 400)["detail"] == {"field": "mu"}


# ── Sessions ────────────────────────────────────────────────────────────────


class TestSessions:
    def test_closing_a_tab_drops_its_replay(self, client: TestClient, replay_trial: Path) -> None:
        headers = {"X-MUreplay-Session": "tab-1"}
        resp = client.post(
            f"{API}/replay/session/open", json={"file_path": str(replay_trial)}, headers=headers
        )
        opened, _ = _frame(resp)
        assert client.post(f"{API}/session/close", params={"session": "tab-1"}).status_code == 204
        resp = client.post(
            f"{API}/replay/seek", json={"token": opened["token"], "steps": []}, headers=headers
        )
        assert error(resp, 400)["detail"] == {"field": "token"}

    def test_each_tab_keeps_its_own_replay(self, client: TestClient, replay_trial: Path) -> None:
        tokens = []
        for tab in ("tab-1", "tab-2"):
            resp = client.post(
                f"{API}/replay/session/open",
                json={"file_path": str(replay_trial)},
                headers={"X-MUreplay-Session": tab},
            )
            tokens.append(_frame(resp)[0]["token"])
        for tab, token in zip(("tab-1", "tab-2"), tokens, strict=True):
            resp = client.post(
                f"{API}/replay/seek",
                json={"token": token, "steps": []},
                headers={"X-MUreplay-Session": tab},
            )
            assert resp.status_code == 200

    def test_a_malformed_session_id_is_a_400_naming_the_header(self, client: TestClient) -> None:
        resp = client.post(
            f"{API}/replay/seek",
            json={"token": "x", "steps": []},
            headers={"X-MUreplay-Session": "../etc"},
        )
        assert error(resp, 400)["detail"] == {"field": "X-MUreplay-Session"}
