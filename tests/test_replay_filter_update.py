"""The ``update_filter`` refit on synthetic EMG; ``test_muedit2_parity`` checks it against MUedit2."""

from __future__ import annotations

import numpy as np

from mureplay.replay.filter_update import update_motor_unit_filter_window

FSAMP = 2000.0


def _synthetic_emg() -> tuple[np.ndarray, np.ndarray, list[int]]:
    """Eight channels of noise with one MU's waveform at a dozen spikes."""
    rng = np.random.default_rng(7)
    n = 3000
    emg = rng.normal(size=(8, n)) * 0.1
    spikes = sorted(rng.integers(250, 750, 12).tolist())
    wave = rng.normal(size=8)[:, None] * np.exp(-(np.linspace(-2, 2, 25) ** 2))[None, :]
    for s in spikes:
        if s + 25 < n:
            emg[:, s : s + 25] += wave
    return emg, np.zeros(8, dtype=int), spikes


# ── Artifact mask ───────────────────────────────────────────────────────────


class TestArtifactMask:
    def test_no_discharge_is_found_inside_a_masked_window(self) -> None:
        emg, discard_mask, spikes = _synthetic_emg()
        _, unmasked = update_motor_unit_filter_window(
            emg, discard_mask, spikes, FSAMP, 0, 1000, nbextchan=1000
        )
        assert len(unmasked) >= 2

        target = int(unmasked[len(unmasked) // 2])
        mask = np.zeros(1000, dtype=bool)
        mask[max(0, target - 30) : target + 30] = True
        _, masked = update_motor_unit_filter_window(
            emg, discard_mask, spikes, FSAMP, 0, 1000, nbextchan=1000, artifact_mask=mask
        )
        assert not mask[masked].any()

    def test_a_mask_shorter_than_the_window_is_ignored(self) -> None:
        emg, discard_mask, spikes = _synthetic_emg()
        _, result = update_motor_unit_filter_window(
            emg,
            discard_mask,
            spikes,
            FSAMP,
            0,
            1000,
            nbextchan=1000,
            artifact_mask=np.zeros(10, dtype=bool),
        )
        assert len(result) >= 2
