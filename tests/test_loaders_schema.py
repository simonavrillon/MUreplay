"""Loader tests against the MUedit2 decomposition file schemas.

MUedit2 writes two .npz layouts: schema v1 (object arrays, ``discharge_times``,
``artifact_mask``) and schema v2 (pickle-free: CSR ``spike_times``/``spike_offsets``,
JSON-in-string members, ``artifact_intervals``, optional ``pulse_trains``).
``load_npz_payload`` must normalize both into the same replay payload.
"""

from __future__ import annotations

import io
import json
from typing import Any

import numpy as np

from mureplay.io.loaders import load_npz_payload

FSAMP = 2000.0
TOTAL_SAMPLES = 500


def _json_array(value: Any) -> np.ndarray:
    """``value`` as JSON in a 0-d unicode array, as MUedit2's saver writes it."""
    return np.array(json.dumps(value))


def _save_v2_npz(buffer: io.BytesIO, *, with_pulse_trains: bool) -> None:
    """A schema v2 file laid out exactly as ``muedit.decomposition_file.save_decomposition_npz``."""
    spikes = np.asarray([10, 20, 30, 5, 15], dtype=np.int32)
    offsets = np.asarray([0, 3, 5], dtype=np.int64)
    members: dict[str, Any] = {
        "schema_version": np.int64(2),
        "fsamp": np.float64(FSAMP),
        "total_samples": np.int64(TOTAL_SAMPLES),
        "spike_times": spikes,
        "spike_offsets": offsets,
        "mu_grid_index": np.asarray([0, 1], dtype=np.int16),
        "grid_names": _json_array(["Grid A", "Grid B"]),
        "muscle": _json_array(["TA"]),
        "parameters": _json_array({"niter": 25}),
        "artifact_intervals": np.asarray([[100, 150]], dtype=np.int64),
    }
    if with_pulse_trains:
        members["pulse_trains"] = np.zeros((2, TOTAL_SAMPLES), dtype=np.float32)
    np.savez(buffer, **members)


def test_schema_v2_roundtrip() -> None:
    buffer = io.BytesIO()
    _save_v2_npz(buffer, with_pulse_trains=True)
    payload = load_npz_payload(buffer.getvalue())

    assert payload["discharge_times"] == [[10, 20, 30], [5, 15]]
    assert payload["grid_names"] == ["Grid A", "Grid B"]
    assert payload["mu_grid_index"] == [0, 1]
    assert payload["fsamp"] == FSAMP
    assert payload["total_samples"] == TOTAL_SAMPLES
    assert payload["artifact_regions"] == [[100, 150]]
    assert payload["artifact_samples"] == 50


def test_schema_v2_without_pulse_trains_builds_binary_trains() -> None:
    buffer = io.BytesIO()
    _save_v2_npz(buffer, with_pulse_trains=False)
    payload = load_npz_payload(buffer.getvalue())

    assert len(payload["pulse_trains"]) == 2
    assert len(payload["pulse_trains"][0]) == TOTAL_SAMPLES
    for row, times in zip(payload["pulse_trains"], payload["discharge_times"], strict=True):
        assert {i for i, v in enumerate(row) if v == 1.0} == set(times)


def test_json_string_member_is_not_char_split() -> None:
    # A 0-d unicode array is one string, not a list of characters: a regression
    # here would turn `grid_names` into '["Grid A", "Grid B"]' split per char.
    buffer = io.BytesIO()
    np.savez(
        buffer,
        schema_version=np.int64(2),
        grid_names=_json_array(["Grid A"]),
        fsamp=np.float64(FSAMP),
    )
    payload = load_npz_payload(buffer.getvalue())
    assert payload["grid_names"] == ["Grid A"]


def test_schema_v1_still_loads() -> None:
    buffer = io.BytesIO()
    mask = np.zeros(TOTAL_SAMPLES, dtype=bool)
    mask[100:150] = True
    np.savez_compressed(
        buffer,
        pulse_trains=np.zeros((1, TOTAL_SAMPLES)),
        discharge_times=np.array([[120, 300]], dtype=object),
        fsamp=np.float64(FSAMP),
        grid_names=np.array(["Grid 1"], dtype=object),
        mu_grid_index=np.array([0], dtype=int),
        total_samples=np.int64(TOTAL_SAMPLES),
        artifact_mask=mask,
    )
    payload = load_npz_payload(buffer.getvalue())

    assert payload["discharge_times"] == [[120, 300]]
    assert payload["grid_names"] == ["Grid 1"]
    assert payload["artifact_regions"] == [[100, 150]]
    assert payload["artifact_samples"] == 50
    assert payload["total_samples"] == TOTAL_SAMPLES
