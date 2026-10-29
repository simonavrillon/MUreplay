"""Decomposition loading: both MUedit2 file schemas, and the decomposition paired with its edit log."""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

import numpy as np
import pytest

from mureplay.errors import NotFoundError
from mureplay.io.loaders import (
    _infer_bids_root,
    _load_npz_payload,
    load_paired_from_path,
)
from mureplay.models import resident_nbytes
from tests.conftest import SAMPLE_ENTITY

FSAMP = 2000.0
TOTAL_SAMPLES = 500


def _json_array(value: Any) -> np.ndarray:
    """``value`` as JSON in a 0-d unicode array, as MUedit2's saver writes it."""
    return np.array(json.dumps(value))


def _npz(path: Path, *, compressed: bool = False, **members: Any) -> Path:
    """``members`` saved as an ``.npz`` at ``path``."""
    (np.savez_compressed if compressed else np.savez)(path, **members)
    return path


def _v2_npz(path: Path, *, with_pulse_trains: bool) -> Path:
    """A schema v2 file laid out as MUedit2's ``save_decomposition_npz`` writes it."""
    members: dict[str, Any] = {
        "schema_version": np.int64(2),
        "fsamp": np.float64(FSAMP),
        "total_samples": np.int64(TOTAL_SAMPLES),
        "spike_times": np.asarray([10, 20, 30, 5, 15], dtype=np.int32),
        "spike_offsets": np.asarray([0, 3, 5], dtype=np.int64),
        "mu_grid_index": np.asarray([0, 1], dtype=np.int16),
        "grid_names": _json_array(["Grid A", "Grid B"]),
        "muscle": _json_array(["TA"]),
        "parameters": _json_array({"niter": 25}),
        "artifact_intervals": np.asarray([[100, 150]], dtype=np.int64),
    }
    if with_pulse_trains:
        members["pulse_trains"] = np.zeros((2, TOTAL_SAMPLES), dtype=np.float32)
    return _npz(path, **members)


def _rows(spike_times: list[np.ndarray]) -> list[list[int]]:
    return [row.tolist() for row in spike_times]


# ── File schemas ────────────────────────────────────────────────────────────


class TestLoadNpzPayload:
    def test_schema_v2_loads(self, tmp_path: Path) -> None:
        payload = _load_npz_payload(_v2_npz(tmp_path / "x.npz", with_pulse_trains=True))
        assert _rows(payload["spike_times"]) == [[10, 20, 30], [5, 15]]
        assert payload["total_samples"] == TOTAL_SAMPLES
        assert payload["grid_names"] == ["Grid A", "Grid B"]
        assert payload["mu_grid_index"] == [0, 1]
        assert payload["fsamp"] == FSAMP
        assert payload["artifact_regions"] == [[100, 150]]

    def test_the_run_settings_load_from_either_schema_with_muedit2_defaults(
        self, tmp_path: Path
    ) -> None:
        v2 = _v2_npz(tmp_path / "v2.npz", with_pulse_trains=False)
        assert _load_npz_payload(v2)["refit_settings"] == {
            "nbextchan": 1000,
            "peel_off_win": 0.025,
            "compute_dtype": "float32",
        }
        run = {"nbextchan": np.int64(640), "peel_off_win": 0.02, "compute_dtype": "float64"}
        v1 = _npz(
            tmp_path / "v1.npz",
            discharge_times=np.array([[1]], dtype=object),
            parameters=np.array(run),
        )
        # v1 pickles the dict; it must not come back as a list of its keys.
        assert _load_npz_payload(v1)["refit_settings"] == {
            "nbextchan": 640,
            "peel_off_win": 0.02,
            "compute_dtype": "float64",
        }

    def test_the_settings_panel_gets_the_run_settings_the_file_holds(self, tmp_path: Path) -> None:
        run = {"niter": np.int64(150), "use_adaptive": True, "sil_thr": 0.9, "grid": "x"}
        path = _npz(
            tmp_path / "x.npz",
            discharge_times=np.array([[1]], dtype=object),
            parameters=np.array(run),
        )
        assert _load_npz_payload(path)["parameters"] == {
            "niter": 150,
            "use_adaptive": True,
            "sil_thr": 0.9,
        }

    def test_unusable_run_settings_fall_back_to_muedit2_defaults(self, tmp_path: Path) -> None:
        run = {"nbextchan": -3, "peel_off_win": "x", "compute_dtype": "int8"}
        path = _npz(
            tmp_path / "x.npz",
            discharge_times=np.array([[1]], dtype=object),
            parameters=np.array(run),
        )
        assert _load_npz_payload(path)["refit_settings"] == {
            "nbextchan": 1000,
            "peel_off_win": 0.025,
            "compute_dtype": "float32",
        }

    def test_the_pulse_trains_are_mapped_from_the_file_not_read(self, tmp_path: Path) -> None:
        payload = _load_npz_payload(_v2_npz(tmp_path / "x.npz", with_pulse_trains=True))
        assert payload["pulse_trains"].shape == (2, TOTAL_SAMPLES)
        assert resident_nbytes(payload["pulse_trains"]) == 0

    def test_a_file_without_pulse_trains_has_none_to_map(self, tmp_path: Path) -> None:
        payload = _load_npz_payload(_v2_npz(tmp_path / "x.npz", with_pulse_trains=False))
        assert payload["pulse_trains"] is None
        assert payload["total_samples"] == TOTAL_SAMPLES

    def test_a_json_string_member_is_not_split_into_characters(self, tmp_path: Path) -> None:
        path = _npz(
            tmp_path / "x.npz",
            schema_version=np.int64(2),
            grid_names=_json_array(["Grid A"]),
            fsamp=np.float64(FSAMP),
        )
        assert _load_npz_payload(path)["grid_names"] == ["Grid A"]

    def test_a_file_without_grids_gets_one_grid_for_every_mu(self, tmp_path: Path) -> None:
        path = _npz(tmp_path / "x.npz", discharge_times=np.array([[1], [2]], dtype=object))
        payload = _load_npz_payload(path)
        assert payload["grid_names"] == ["Grid 1"]
        assert payload["mu_grid_index"] == [0, 0]

    def test_schema_v1_still_loads(self, tmp_path: Path) -> None:
        mask = np.zeros(TOTAL_SAMPLES, dtype=bool)
        mask[100:150] = True
        path = _npz(
            tmp_path / "x.npz",
            compressed=True,
            pulse_trains=np.zeros((1, TOTAL_SAMPLES)),
            discharge_times=np.array([[120, 300]], dtype=object),
            fsamp=np.float64(FSAMP),
            grid_names=np.array(["Grid 1"], dtype=object),
            mu_grid_index=np.array([0], dtype=int),
            total_samples=np.int64(TOTAL_SAMPLES),
            artifact_mask=mask,
        )
        payload = _load_npz_payload(path)
        assert _rows(payload["spike_times"]) == [[120, 300]]
        # Compressed, so read rather than mapped.
        assert payload["pulse_trains"].shape == (1, TOTAL_SAMPLES)
        assert payload["grid_names"] == ["Grid 1"]
        assert payload["artifact_regions"] == [[100, 150]]


# ── Pairing ─────────────────────────────────────────────────────────────────


class TestInferBidsRoot:
    def test_a_derivatives_file_points_at_the_dataset_root(self) -> None:
        path = Path("/d/derivatives/muedit/sub-1/ses-1/decomp/x_edited.npz")
        assert _infer_bids_root(path) == str(Path("/d"))

    def test_a_flat_layout_points_above_the_subject(self) -> None:
        assert _infer_bids_root(Path("/d/sub-1/x_edited.npz")) == str(Path("/d"))


class TestLoadPairedFromPath:
    def test_a_file_without_its_edit_log_is_not_found(self, tmp_path: Path) -> None:
        path = _v2_npz(tmp_path / "sub-1_task-x_decomp.npz", with_pulse_trains=False)
        with pytest.raises(NotFoundError, match="edited JSON"):
            load_paired_from_path(path)

    def test_the_sample_session_pairs_its_decomposition_and_log(
        self, sample_bids_root: Path
    ) -> None:
        decomp = sample_bids_root / "derivatives" / "muedit" / "sub-1" / "ses-1" / "decomp"
        payload = load_paired_from_path(decomp / f"{SAMPLE_ENTITY}_edited.npz")

        assert payload["source_filename"] == f"{SAMPLE_ENTITY}_decomp.npz"
        assert payload["entity_label"] == SAMPLE_ENTITY
        assert payload["bids_root"] == str(sample_bids_root)
        # The decomposition holds 36 MUs; the log's 34 uids are those left after two removals,
        # so its MUs are numbered as MUedit2 did when the session opened.
        assert len(payload["spike_times"]) == 36
        assert len(payload["pulse_trains"]) == len(payload["mu_grid_index"]) == 36
        assert payload["mu_uids"][:2] == ["g0_mu0", "g1_mu0"]
        assert len(payload["mu_uids"]) == 36
        assert len(payload["edit_history"]) == 98
        assert {"add_spikes", "remove_outliers", "update_filter", "flag_mu"} <= {
            str(step.get("type")) for step in payload["edit_history"]
        }
        assert payload["parameters"]["niter"] == 25
        assert payload["sidecar_meta"]["manufacturer"] == "OT Bioelettronica"

    def test_the_decomposition_and_the_edited_file_open_the_same_session(
        self, sample_bids_root: Path
    ) -> None:
        decomp = sample_bids_root / "derivatives" / "muedit" / "sub-1" / "ses-1" / "decomp"
        via_decomp = load_paired_from_path(decomp / f"{SAMPLE_ENTITY}_decomp.npz")
        via_edited = load_paired_from_path(decomp / f"{SAMPLE_ENTITY}_edited.npz")
        assert via_decomp["source_filename"] == via_edited["source_filename"]
        assert via_decomp["edit_history"] == via_edited["edit_history"]
        assert via_decomp["mu_uids"] == via_edited["mu_uids"]

    def test_an_unedited_session_loads_with_an_empty_log(self, sample_bids_root: Path) -> None:
        decomp = sample_bids_root / "derivatives" / "muedit" / "sub-2" / "ses-1" / "decomp"
        payload = load_paired_from_path(next(decomp.glob("*_edited.npz")))
        assert payload["spike_times"]
        assert payload["edit_history"] == []
