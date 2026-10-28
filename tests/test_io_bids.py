"""The BIDS EMG reader: one grid's rows, picked and clamped as MUedit2's reader does."""

from __future__ import annotations

import json
from pathlib import Path

import numpy as np
import pyedflib
import pytest

from mureplay.errors import MureplayError, NotFoundError
from mureplay.io.bids import entity_pairs, grid_rows, read_bids_emg_grid
from tests.conftest import SAMPLE_ENTITY

FSAMP = 2000.0
#: Samples the EDF file holds, and the fewer its sidecar's RecordingDuration declares.
N_STORED = 3000
N_DECLARED = 2800
ENTITY = "sub-1_task-t_test"
GRID_TSV_HEADER = "name\ttype\tunits\tdescription\tsampling_frequency\tgroup\tstatus\n"


def _write_edf(path: Path, data: np.ndarray) -> None:
    """``data`` as an EDF+ recording, one ``ChNN`` signal per row."""
    peak = float(np.abs(data).max()) or 1.0
    writer = pyedflib.EdfWriter(
        str(path), n_channels=len(data), file_type=pyedflib.FILETYPE_EDFPLUS
    )
    writer.setSignalHeaders(
        [
            {
                "label": f"Ch{i + 1:02d}",
                "dimension": "uV",
                "sample_frequency": FSAMP,
                "physical_min": -peak,
                "physical_max": peak,
                "digital_min": -32768,
                "digital_max": 32767,
                "transducer": "",
                "prefilter": "",
            }
            for i in range(len(data))
        ]
    )
    writer.writeSamples(data)
    writer.close()


@pytest.fixture
def padded_bids_root(tmp_path: Path) -> Path:
    """A minimal BIDS EMG recording whose file holds 200 samples of padding."""
    emg_dir = tmp_path / "sub-1" / "emg"
    emg_dir.mkdir(parents=True)
    _write_edf(
        emg_dir / f"{ENTITY}_emg.edf", np.random.default_rng(7).normal(size=(2, N_STORED)) * 10
    )
    (emg_dir / f"{ENTITY}_channels.tsv").write_text(
        GRID_TSV_HEADER + "Ch01\tEMG\tuV\tEMG\t2000.0\tGrid1\tgood\n"
        "Ch02\tEMG\tuV\tEMG\t2000.0\tGrid1\tbad\n",
        encoding="utf-8",
    )
    (emg_dir / f"{ENTITY}_emg.json").write_text(
        json.dumps({"SamplingFrequency": FSAMP, "RecordingDuration": N_DECLARED / FSAMP}),
        encoding="utf-8",
    )
    return tmp_path


# ── Reading a grid ──────────────────────────────────────────────────────────


class TestReadBidsEmgGrid:
    def test_a_padded_recording_is_clamped_to_its_declared_duration(
        self, padded_bids_root: Path
    ) -> None:
        # EDF/BDF stores whole data records, so the writer zero-pads the last one; reading the
        # padding would change the whole-signal filtering MUedit2 replays bit for bit.
        data, fsamp, discard_mask = read_bids_emg_grid(padded_bids_root, ENTITY, grid=0)
        assert data.shape == (2, N_DECLARED)
        assert fsamp == FSAMP
        assert discard_mask.tolist() == [0, 1]
        assert data.dtype == np.float32

    def test_without_a_sidecar_the_stored_length_is_read(self, tmp_path: Path) -> None:
        emg_dir = tmp_path / "sub-1" / "emg"
        emg_dir.mkdir(parents=True)
        _write_edf(emg_dir / f"{ENTITY}_emg.edf", np.zeros((1, N_STORED)))
        (emg_dir / f"{ENTITY}_channels.tsv").write_text(
            GRID_TSV_HEADER + "Ch01\tEMG\tuV\tEMG\t2000.0\tGrid1\tgood\n", encoding="utf-8"
        )
        with pyedflib.EdfReader(str(emg_dir / f"{ENTITY}_emg.edf")) as reader:
            stored_n = int(reader.getNSamples()[0])

        data, _, _ = read_bids_emg_grid(tmp_path, ENTITY, grid=0)
        assert data.shape == (1, stored_n)
        assert stored_n >= N_STORED

    def test_an_unknown_grid_names_the_grid(self, padded_bids_root: Path) -> None:
        with pytest.raises(MureplayError) as caught:
            read_bids_emg_grid(padded_bids_root, ENTITY, grid=3)
        assert caught.value.field == "mu_grid_index"

    def test_a_missing_recording_names_the_dataset(self, tmp_path: Path) -> None:
        with pytest.raises(NotFoundError) as caught:
            read_bids_emg_grid(tmp_path, ENTITY, grid=0)
        assert caught.value.field == "bids_root"

    def test_the_sample_recording_reads(self, sample_bids_root: Path) -> None:
        data, fsamp, discard_mask = read_bids_emg_grid(sample_bids_root, SAMPLE_ENTITY, grid=0)
        assert data.shape[0] == discard_mask.shape[0]
        assert fsamp == pytest.approx(2000.0)
        assert bool(np.isfinite(data).all())

    def test_channels_are_matched_to_edf_signals_by_name(self, padded_bids_root: Path) -> None:
        # channels.tsv lists Ch02 first; MUedit2 reads the EDF signal of that name, not the first.
        emg_dir = padded_bids_root / "sub-1" / "emg"
        (emg_dir / f"{ENTITY}_channels.tsv").write_text(
            GRID_TSV_HEADER + "Ch02\tEMG\tuV\tEMG\t2000.0\tGrid1\tbad\n"
            "Ch01\tEMG\tuV\tEMG\t2000.0\tGrid1\tgood\n",
            encoding="utf-8",
        )
        swapped, _, discard_mask = read_bids_emg_grid(padded_bids_root, ENTITY, grid=0)
        with pyedflib.EdfReader(str(emg_dir / f"{ENTITY}_emg.edf")) as reader:
            ch02 = reader.readSignal(1, start=0, n=N_DECLARED)
        np.testing.assert_allclose(swapped[0], ch02.astype(np.float32))
        assert discard_mask.tolist() == [1, 0]

    def test_an_inherited_sidecar_declares_the_duration(self, padded_bids_root: Path) -> None:
        emg_dir = padded_bids_root / "sub-1" / "emg"
        (emg_dir / f"{ENTITY}_emg.json").unlink()
        (padded_bids_root / "task-t_emg.json").write_text(
            json.dumps({"RecordingDuration": N_DECLARED / FSAMP}), encoding="utf-8"
        )
        data, _, _ = read_bids_emg_grid(padded_bids_root, ENTITY, grid=0)
        assert data.shape == (2, N_DECLARED)


class TestGridRows:
    def test_grids_sort_by_number_and_skip_aux_rows(self) -> None:
        rows = [
            {"type": "EMG", "group": "Grid2"},
            {"type": "EMG", "group": "Grid10"},
            {"type": "EMG", "group": "n/a"},
            {"type": "MISC", "group": "Grid1"},
            {"type": "emg", "group": "Grid2"},
        ]
        assert grid_rows(rows) == [[0, 4], [1]]

    def test_named_groups_keep_their_listed_order(self) -> None:
        rows = [{"type": "EMG", "group": "TA"}, {"type": "EMG", "group": "GM"}]
        assert grid_rows(rows) == [[0], [1]]


class TestEntityLabel:
    def test_its_entities_are_read(self) -> None:
        assert entity_pairs("sub-1_ses-2_task-x_run-1") == {
            "sub": "1",
            "ses": "2",
            "task": "x",
            "run": "1",
        }

    def test_a_label_without_a_subject_is_refused(self, tmp_path: Path) -> None:
        with pytest.raises(MureplayError) as caught:
            read_bids_emg_grid(tmp_path, "task-x_run-1", grid=0)
        assert caught.value.field == "entity_label"
