"""Artifact-mask pipeline: detection, manual regions, transport, and persistence."""

from __future__ import annotations

import io
from pathlib import Path
from typing import Any

import numpy as np
from fastapi.testclient import TestClient

from mureplay.api.app_factory import create_app
from mureplay.api.routes import include_routers
from mureplay.io.loaders import load_npz_payload
from mureplay.replay.artifact_mask import (
    build_manual_artifact_mask,
    mask_to_regions,
    parse_artifact_regions,
)
from mureplay.replay.filter_update import update_motor_unit_filter_window

FSAMP = 2000.0


def make_client(raise_server_exceptions: bool = True) -> TestClient:
    app = create_app()
    include_routers(app)
    return TestClient(app, raise_server_exceptions=raise_server_exceptions)


# ── Manual mask rasterization ────────────────────────────────────────────────


def test_build_manual_mask_from_regions() -> None:
    mask = build_manual_artifact_mask([(10, 20), (30, 40)], 50)
    assert mask is not None
    assert mask.sum() == 20
    assert mask[10:20].all()
    assert mask[30:40].all()
    assert not mask[:10].any()
    assert not mask[20:30].any()


def test_build_manual_mask_swaps_and_clamps() -> None:
    mask = build_manual_artifact_mask([(40, 10)], 50)
    assert mask is not None
    assert mask[10:40].all()

    clamped = build_manual_artifact_mask([(30, 100)], 50)
    assert clamped is not None
    assert clamped.sum() == 20
    assert clamped[30:50].all()


def test_build_manual_mask_none_cases() -> None:
    assert build_manual_artifact_mask(None, 50) is None
    assert build_manual_artifact_mask([], 50) is None
    assert build_manual_artifact_mask([(10, 20)], 0) is None
    assert build_manual_artifact_mask([(60, 70)], 50) is None


def test_mask_to_regions_roundtrip() -> None:
    mask = np.zeros(100, dtype=bool)
    mask[5:15] = True
    mask[40:60] = True
    regions = mask_to_regions(mask)
    assert regions == [[5, 15], [40, 60]]

    rebuilt = build_manual_artifact_mask([(s, e) for s, e in regions], 100)
    assert rebuilt is not None
    assert np.array_equal(rebuilt, mask)


def test_mask_to_regions_empty() -> None:
    assert mask_to_regions(None) == []
    assert mask_to_regions(np.zeros(10, dtype=bool)) == []


# ── Region parsing ───────────────────────────────────────────────────────────


def test_parse_artifact_regions_pairs_and_dicts() -> None:
    raw: list[Any] = [[10, 20], {"start": 30, "end": 40}]
    assert parse_artifact_regions(raw) == [(10, 20), (30, 40)]
    assert parse_artifact_regions(None) == []
    assert parse_artifact_regions([]) == []


def test_parse_artifact_regions_skips_invalid() -> None:
    raw: list[Any] = [[10], "bad", {"start": 5}, [1, 2, 3], ["a", "b"], [50, 60]]
    assert parse_artifact_regions(raw) == [(50, 60)]


# ── Filter update with mask ─────────────────────────────────────────────────


def _synthetic_emg() -> tuple[np.ndarray, np.ndarray, list[int]]:
    rng = np.random.default_rng(7)
    n = 3000
    emg = rng.normal(size=(8, n)) * 0.1
    spikes = sorted(rng.integers(250, 750, 12).tolist())
    wave = rng.normal(size=8)[:, None] * np.exp(-(np.linspace(-2, 2, 25) ** 2))[None, :]
    for s in spikes:
        if s + 25 < n:
            emg[:, s : s + 25] += wave
    bad_mask = np.zeros(8, dtype=int)
    return emg, bad_mask, spikes


def test_update_filter_mask_removes_masked_spikes() -> None:
    emg, bad_mask, spikes = _synthetic_emg()

    _, unmasked = update_motor_unit_filter_window(
        emg, bad_mask, spikes, FSAMP, 0, 1000, nbextchan=1000
    )
    assert len(unmasked) >= 2

    # Mask the region around a detected spike; the masked run must not
    # report any spike inside it.
    target = unmasked[len(unmasked) // 2]
    mask = np.zeros(1000, dtype=bool)
    mask[max(0, target - 30) : target + 30] = True

    _, masked = update_motor_unit_filter_window(
        emg, bad_mask, spikes, FSAMP, 0, 1000, nbextchan=1000, artifact_mask=mask
    )
    assert all(not (mask[s]) for s in masked)


def test_update_filter_mask_size_mismatch_is_ignored() -> None:
    emg, bad_mask, spikes = _synthetic_emg()

    short_mask = np.zeros(10, dtype=bool)
    _, result = update_motor_unit_filter_window(
        emg, bad_mask, spikes, FSAMP, 0, 1000, nbextchan=1000, artifact_mask=short_mask
    )
    # The window-slice size check fails, so the mask is ignored: the run
    # must still complete and return spikes.
    assert len(result) >= 2


# ── Load transport ──────────────────────────────────────────────────────────


def test_load_npz_payload_exposes_artifact_regions() -> None:
    buffer = io.BytesIO()
    mask = np.zeros(500, dtype=bool)
    mask[100:150] = True
    np.savez_compressed(
        buffer,
        pulse_trains=np.zeros((1, 500)),
        discharge_times=np.array([[120, 300]], dtype=object),
        fsamp=FSAMP,
        grid_names=np.array(["Grid 1"], dtype=object),
        mu_grid_index=np.array([0], dtype=int),
        total_samples=500,
        artifact_mask=mask,
    )
    payload = load_npz_payload(buffer.getvalue())
    assert payload["artifact_regions"] == [[100, 150]]
    assert payload["artifact_samples"] == 50


# ── HTTP endpoints ──────────────────────────────────────────────────────────


def test_update_filter_accepts_artifact_regions_key() -> None:
    # The schema must accept artifact_regions; without BIDS data the service
    # still fails on the missing EMG, and that message naming the EMG path is
    # what proves the key passed validation and reached the service layer.
    client = make_client(raise_server_exceptions=False)
    response = client.post(
        "/api/v1/edit/update-filter",
        json={
            "bids_root": "/nonexistent",
            "entity_label": "sub-1",
            "distimes": [[100]],
            "mu_index": 0,
            "view_start": 0,
            "view_end": 100,
            "artifact_regions": [[10, 20]],
        },
    )
    assert response.status_code == 404
    error = response.json()["error"]
    assert error["code"] == "http_404"
    # The service resolves the EMG directory with native path separators.
    assert str(Path("/nonexistent") / "sub-1" / "emg") in error["message"]
