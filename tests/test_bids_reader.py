"""BIDS EMG reader tests: the sample-count clamp that keeps replay bit-exact.

EDF/BDF stores whole data records, so a writer zero-pads the last one. The
``*_emg.json`` sidecar's ``RecordingDuration`` is the only record of where the
signal really ends — MUedit2's reader clamps to it, and the whole-signal notch
and bandpass mean reading past it would shift borderline spike detection.
"""

from __future__ import annotations

import json
from pathlib import Path

import numpy as np
import pyedflib
import pytest

from mureplay.io.bids import load_bids_emg_grid

FSAMP = 2000.0
N_STORED = 3000  # what the EDF file physically holds
N_DECLARED = 2800  # what RecordingDuration says
ENTITY = "sub-1_task-t_test"
GRID_TSV_HEADER = "name\ttype\tunits\tdescription\tsampling_frequency\tgroup\tstatus\n"


@pytest.fixture
def padded_bids_root(tmp_path: Path) -> Path:
    """A minimal BIDS EMG recording whose file holds 200 samples of padding."""
    emg_dir = tmp_path / "sub-1" / "emg"
    emg_dir.mkdir(parents=True)

    writer = pyedflib.EdfWriter(
        str(emg_dir / f"{ENTITY}_emg.edf"), n_channels=2, file_type=pyedflib.FILETYPE_EDFPLUS
    )
    rng = np.random.default_rng(7)
    data = rng.normal(size=(2, N_STORED)).astype(np.float64) * 10
    writer.setSignalHeaders(
        [
            {
                "label": "Ch01",
                "dimension": "uV",
                "sample_frequency": FSAMP,
                "physical_min": float(-data.max()),
                "physical_max": float(data.max()),
                "digital_min": -32768,
                "digital_max": 32767,
                "transducer": "",
                "prefilter": "",
            },
            {
                "label": "Ch02",
                "dimension": "uV",
                "sample_frequency": FSAMP,
                "physical_min": float(-data.max()),
                "physical_max": float(data.max()),
                "digital_min": -32768,
                "digital_max": 32767,
                "transducer": "",
                "prefilter": "",
            },
        ]
    )
    writer.writeSamples(data)
    writer.close()

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


def test_padded_edf_is_clamped_to_declared_duration(padded_bids_root: Path) -> None:
    data, fsamp, bad_mask = load_bids_emg_grid(padded_bids_root, ENTITY, grid_index=0)
    assert data.shape == (2, N_DECLARED)
    assert fsamp == FSAMP
    assert bad_mask.tolist() == [0, 1]
    assert data.dtype == np.float32


def test_windowed_read_is_clamped_to_declared_duration(padded_bids_root: Path) -> None:
    data, _, _ = load_bids_emg_grid(
        padded_bids_root, ENTITY, grid_index=0, read_start=N_DECLARED - 100, read_n=500
    )
    # 500 asked, only 100 remain before the declared end.
    assert data.shape == (2, 100)


def test_missing_sidecar_reads_stored_length(tmp_path: Path) -> None:
    """Without RecordingDuration the stored length is the only bound."""
    emg_dir = tmp_path / "sub-1" / "emg"
    emg_dir.mkdir(parents=True)
    writer = pyedflib.EdfWriter(
        str(emg_dir / f"{ENTITY}_emg.edf"), n_channels=1, file_type=pyedflib.FILETYPE_EDFPLUS
    )
    writer.setSignalHeaders(
        [
            {
                "label": "Ch01",
                "dimension": "uV",
                "sample_frequency": FSAMP,
                "physical_min": -100.0,
                "physical_max": 100.0,
                "digital_min": -32768,
                "digital_max": 32767,
                "transducer": "",
                "prefilter": "",
            }
        ]
    )
    writer.writeSamples(np.zeros((1, N_STORED)))
    writer.close()
    (emg_dir / f"{ENTITY}_channels.tsv").write_text(
        GRID_TSV_HEADER + "Ch01\tEMG\tuV\tEMG\t2000.0\tGrid1\tgood\n", encoding="utf-8"
    )

    # EDF stores whole data records, so the writer may pad past what was given.
    with pyedflib.EdfReader(str(emg_dir / f"{ENTITY}_emg.edf")) as reader:
        stored_n = int(reader.getNSamples()[0])

    data, _, _ = load_bids_emg_grid(tmp_path, ENTITY, grid_index=0)
    assert data.shape == (1, stored_n)
    assert stored_n >= N_STORED
