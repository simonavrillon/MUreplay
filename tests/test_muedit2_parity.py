"""Cross-repo parity tests: MUreplay operations must match MUedit2's exactly.

MUedit2 is the reference implementation; MUreplay mirrors it. These tests
import both packages side by side and assert identical outputs on shared
synthetic inputs, so any future change in either codebase that breaks the
mirror fails here instead of silently diverging.

MUedit2 is expected as a sibling checkout (``../MUedit2``); override with the
``MUEDIT2_ROOT`` environment variable. The module skips cleanly when the
sibling repo is absent, so environments without it stay green.
"""

from __future__ import annotations

import importlib
import importlib.util
import os
import sys
import types
from functools import cache
from pathlib import Path
from typing import Any

import numpy as np
import pytest

from mureplay.replay.artifact_mask import build_manual_artifact_mask
from mureplay.replay.filter_update import update_motor_unit_filter_window
from mureplay.replay.operations import (
    add_artifact_in_roi,
    add_spikes_in_roi,
    delete_artifacts_in_roi,
    delete_high_discharge_rate_spikes_in_roi,
    delete_spikes_in_roi,
    remove_discharge_rate_outliers,
)

REPO_ROOT = Path(__file__).resolve().parents[1]
MUEDIT2_ROOT = Path(os.environ.get("MUEDIT2_ROOT") or (REPO_ROOT.parent / "MUedit2"))
MUEDIT2_SRC = MUEDIT2_ROOT / "python" / "src"

pytestmark = pytest.mark.skipif(
    not (MUEDIT2_SRC / "muedit" / "editing" / "operations.py").is_file(),
    reason="MUedit2 sibling checkout not present (set MUEDIT2_ROOT to locate it)",
)

FSAMP = 2000.0


@cache
def _mu2(module: str) -> Any:
    """Import a muedit module lazily, stubbing optional heavy dependencies.

    The muedit import chain pulls in h5py (MATLAB v7.3 reader) and xmltodict
    (OTB metadata reader). No compared operation touches either, so missing
    packages are replaced with inert stubs instead of failing the import.
    """
    for missing, attrs in (
        (
            "h5py",
            {
                "File": type("File", (), {}),
                "Group": type("Group", (), {}),
                "Dataset": type("Dataset", (), {}),
                "Reference": type("Reference", (), {}),
                "is_hdf5": lambda _path: False,
            },
        ),
        ("xmltodict", {"parse": lambda *args, **kwargs: {}}),
    ):
        if missing not in sys.modules and importlib.util.find_spec(missing) is None:
            stub = types.ModuleType(missing)
            for attr, value in attrs.items():
                setattr(stub, attr, value)
            sys.modules[missing] = stub

    src = str(MUEDIT2_SRC)
    if src not in sys.path:
        sys.path.insert(0, src)
    return importlib.import_module(module)


def _mu2_ops() -> Any:
    return _mu2("muedit.editing.operations")


# ── Shared synthetic inputs ─────────────────────────────────────────────────


def _pulse(seed: int, length: int = 1000) -> np.ndarray:
    rng = np.random.default_rng(seed)
    pulse = np.abs(rng.normal(size=length)) * 0.3
    for pos in rng.integers(20, length - 20, 12):
        pulse[int(pos)] += rng.uniform(0.4, 1.2)
    return pulse


def _spikes(seed: int, length: int = 1000, count: int = 15) -> list[int]:
    rng = np.random.default_rng(seed)
    return sorted({int(v) for v in rng.integers(0, length, count)})


def _emg(seed: int) -> tuple[np.ndarray, np.ndarray, list[int]]:
    rng = np.random.default_rng(seed)
    n = 3000
    emg = rng.normal(size=(8, n)) * 0.1
    spikes = sorted({int(v) for v in rng.integers(250, 750, 12)})
    wave = rng.normal(size=8)[:, None] * np.exp(-(np.linspace(-2, 2, 25) ** 2))[None, :]
    for s in spikes:
        if s + 25 < n:
            emg[:, s : s + 25] += wave
    bad_mask = np.zeros(8, dtype=int)
    return emg, bad_mask, spikes


# ── Pure editing operations ─────────────────────────────────────────────────


@pytest.mark.parametrize("seed", range(8))
def test_add_spikes_in_roi_parity(seed: int) -> None:
    pulse = _pulse(seed)
    spikes = _spikes(seed)
    x_start, x_end = 100, 600
    y_min = 0.35

    mu2 = _mu2_ops().add_spikes_in_roi(pulse, spikes, FSAMP, x_start, x_end, y_min)
    mr = add_spikes_in_roi(pulse, spikes, FSAMP, x_start, x_end, y_min)
    assert mr == mu2


@pytest.mark.parametrize("seed", range(8))
def test_add_artifact_in_roi_parity(seed: int) -> None:
    pulse = _pulse(seed)
    artifacts = _spikes(seed)
    x_start, x_end = 50, 500
    y_min = 0.3

    mu2 = _mu2_ops().add_artifact_in_roi(pulse, artifacts, FSAMP, x_start, x_end, y_min)
    mr = add_artifact_in_roi(pulse, artifacts, FSAMP, x_start, x_end, y_min)
    assert mr == mu2


@pytest.mark.parametrize("seed", range(8))
def test_delete_spikes_in_roi_parity(seed: int) -> None:
    pulse = _pulse(seed)
    spikes = _spikes(seed)
    x_start, x_end = 100, 800
    y_min, y_max = 0.2, 0.8

    mu2 = _mu2_ops().delete_spikes_in_roi(pulse, spikes, x_start, x_end, y_min, y_max)
    mr = delete_spikes_in_roi(pulse, spikes, x_start, x_end, y_min, y_max)
    assert mr == mu2


@pytest.mark.parametrize("seed", range(8))
def test_delete_artifacts_in_roi_parity(seed: int) -> None:
    pulse = _pulse(seed)
    artifacts = _spikes(seed)
    x_start, x_end = 100, 800
    y_min, y_max = 0.2, 0.8

    mu2 = _mu2_ops().delete_artifacts_in_roi(pulse, artifacts, x_start, x_end, y_min, y_max)
    mr = delete_artifacts_in_roi(pulse, artifacts, x_start, x_end, y_min, y_max)
    assert mr == mu2


@pytest.mark.parametrize("seed", range(8))
def test_delete_high_discharge_rate_spikes_in_roi_parity(seed: int) -> None:
    pulse = _pulse(seed)
    spikes = _spikes(seed, count=20)
    x_start, x_end = 100, 900
    y_min = 20.0

    mu2 = _mu2_ops().delete_high_discharge_rate_spikes_in_roi(
        pulse, spikes, FSAMP, x_start, x_end, y_min
    )
    mr = delete_high_discharge_rate_spikes_in_roi(pulse, spikes, FSAMP, x_start, x_end, y_min)
    assert mr == mu2


@pytest.mark.parametrize("seed", range(8))
def test_remove_discharge_rate_outliers_parity(seed: int) -> None:
    pulse = _pulse(seed)
    spikes = _spikes(seed, count=25)

    mu2 = _mu2_ops().remove_discharge_rate_outliers(pulse, spikes, FSAMP)
    mr = remove_discharge_rate_outliers(pulse, spikes, FSAMP)
    assert mr == mu2


# ── Artifact mask consumption ───────────────────────────────────────────────


@pytest.mark.parametrize("seed", range(4))
def test_build_manual_artifact_mask_parity(seed: int) -> None:
    rng = np.random.default_rng(2000 + seed)
    n = 5000
    regions = sorted(
        {
            (
                int(rng.integers(0, n)),
                int(rng.integers(0, n)),
            )
            for _ in range(6)
        }
    )

    mu2 = _mu2("muedit.decomp.preprocess").build_manual_artifact_mask(regions, n)
    mr = build_manual_artifact_mask(regions, n)
    if mu2 is None or mr is None:
        assert (mu2 is None) == (mr is None)
    else:
        assert mr.tolist() == mu2.tolist()


# ── Filter update (recomputation) ───────────────────────────────────────────


def _compare_update(
    seed: int,
    spike_times: list[int] | None = None,
    **kwargs: Any,
) -> None:
    emg, bad_mask, spikes = _emg(seed)
    if spike_times is None:
        spike_times = spikes
    start, end = 0, 1000

    pt_mu2, up_mu2 = _mu2_ops().update_motor_unit_filter_window(
        emg, bad_mask, spike_times, FSAMP, start, end, nbextchan=1000, **kwargs
    )
    pt_mr, up_mr = update_motor_unit_filter_window(
        emg, bad_mask, spike_times, FSAMP, start, end, nbextchan=1000, **kwargs
    )
    assert up_mr == up_mu2
    if pt_mu2 is None or pt_mr is None:
        assert (pt_mu2 is None) == (pt_mr is None)
    else:
        # Integer spike outputs must match exactly; the pulse train is allowed
        # float-noise differences (BLAS reduction order), so compare loosely.
        assert np.allclose(pt_mr, pt_mu2, rtol=1e-9, atol=1e-9)


@pytest.mark.parametrize("seed", range(4))
def test_update_filter_baseline_parity(seed: int) -> None:
    _compare_update(seed)


@pytest.mark.parametrize("seed", range(4))
def test_update_filter_peeloff_parity(seed: int) -> None:
    other: list[list[int]] = [[300, 400, 600], [350, 500]]
    _compare_update(seed, peeloff_spike_times=other, use_peeloff=True, peeloff_win=0.025)


@pytest.mark.parametrize("seed", range(4))
def test_update_filter_artifacts_parity(seed: int) -> None:
    _compare_update(seed, artifact_times=[260, 700])


@pytest.mark.parametrize("seed", range(4))
def test_update_filter_lock_spikes_parity(seed: int) -> None:
    _bad, spikes = _emg(seed)[1:]
    locked = sorted({spikes[0], 400, 600})
    _compare_update(seed, spike_times=locked, lock_spikes=True)


@pytest.mark.parametrize("seed", range(4))
def test_update_filter_artifact_mask_parity(seed: int) -> None:
    mask = np.zeros(1000, dtype=bool)
    mask[300:420] = True
    _compare_update(seed, artifact_mask=mask)


@pytest.mark.parametrize("seed", range(4))
def test_update_filter_mask_and_lock_parity(seed: int) -> None:
    spikes = _emg(seed)[2]
    locked = sorted({spikes[0], 400, 600})
    mask = np.zeros(1000, dtype=bool)
    mask[300:420] = True
    _compare_update(seed, spike_times=locked, lock_spikes=True, artifact_mask=mask)


@pytest.mark.parametrize("seed", range(4))
def test_update_filter_mask_and_peeloff_parity(seed: int) -> None:
    other: list[list[int]] = [[300, 400, 600]]
    mask = np.zeros(1000, dtype=bool)
    mask[300:420] = True
    _compare_update(
        seed,
        peeloff_spike_times=other,
        use_peeloff=True,
        peeloff_win=0.025,
        artifact_mask=mask,
    )


@pytest.mark.parametrize("seed", range(4))
def test_update_filter_fully_masked_parity(seed: int) -> None:
    mask = np.ones(1000, dtype=bool)
    _compare_update(seed, artifact_mask=mask)
