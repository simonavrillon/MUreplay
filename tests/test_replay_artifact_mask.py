"""Artifact windows: regions rasterized to a mask, a mask turned back into intervals."""

from __future__ import annotations

import numpy as np

from mureplay.replay.artifact_mask import build_manual_artifact_mask, mask_to_intervals

# ── Rasterization ───────────────────────────────────────────────────────────


class TestBuildManualArtifactMask:
    def test_regions_become_masked_samples(self) -> None:
        mask = build_manual_artifact_mask([(10, 20), (30, 40)], 50)
        assert mask is not None
        assert mask.sum() == 20
        assert mask[10:20].all()
        assert mask[30:40].all()
        assert not mask[:10].any()
        assert not mask[20:30].any()

    def test_reversed_regions_swap_and_overhangs_clamp(self) -> None:
        mask = build_manual_artifact_mask([(40, 10)], 50)
        assert mask is not None
        assert mask[10:40].all()

        clamped = build_manual_artifact_mask([(30, 100)], 50)
        assert clamped is not None
        assert clamped.sum() == 20
        assert clamped[30:50].all()

    def test_nothing_to_mask_is_none(self) -> None:
        assert build_manual_artifact_mask(None, 50) is None
        assert build_manual_artifact_mask([], 50) is None
        assert build_manual_artifact_mask([(10, 20)], 0) is None
        assert build_manual_artifact_mask([(60, 70)], 50) is None


# ── Intervals ───────────────────────────────────────────────────────────────


class TestMaskToIntervals:
    def test_regions_round_trip_through_the_mask(self) -> None:
        mask = np.zeros(100, dtype=bool)
        mask[5:15] = True
        mask[40:60] = True
        regions = mask_to_intervals(mask)
        assert regions == [[5, 15], [40, 60]]

        rebuilt = build_manual_artifact_mask([(s, e) for s, e in regions], 100)
        assert rebuilt is not None
        assert np.array_equal(rebuilt, mask)

    def test_an_empty_mask_has_no_intervals(self) -> None:
        assert mask_to_intervals(None) == []
        assert mask_to_intervals(np.zeros(10, dtype=bool)) == []
