"""Replay operations: logged diffs on a row, and the MUs a refit leaves out of its peel-off."""

from __future__ import annotations

from typing import Any

from mureplay.replay.filter_update import spike_array
from mureplay.replay.operations import apply_diff, inactive_mus_before, sample_array

UIDS = ["g0_mu0", "g0_mu1", "g0_mu2"]


class TestApplyDiff:
    def test_removals_go_before_additions_and_the_row_stays_sorted(self) -> None:
        row = apply_diff(spike_array([10, 30]), spike_array([20, 30]), spike_array([30, 99]))
        assert row.tolist() == [10, 20, 30]

    def test_what_is_not_a_number_in_the_log_is_skipped(self) -> None:
        assert sample_array([5, "junk", None, True, 2.0, float("nan")]).tolist() == [2, 5]


class TestInactiveMusBefore:
    def test_flagged_and_removed_mus_are_left_out(self) -> None:
        history: list[dict[str, Any]] = [
            {"type": "flag_mu", "mu_uid": "g0_mu0"},
            {"type": "remove_duplicates", "removed_mu_uids": ["g0_mu2"]},
            {"type": "update_filter", "mu_uid": "g0_mu1"},
        ]
        assert inactive_mus_before(history, 2, UIDS) == [0, 2]

    def test_any_other_edit_clears_a_flag(self) -> None:
        history = [
            {"type": "flag_mu", "mu_uid": "g0_mu0"},
            {"type": "add_spikes", "mu_uid": "g0_mu0"},
            {"type": "update_filter", "mu_uid": "g0_mu1"},
        ]
        assert inactive_mus_before(history, 2, UIDS) == []

    def test_unflagging_is_logged_as_flagged_false(self) -> None:
        history: list[dict[str, Any]] = [
            {"type": "flag_mu", "mu_uid": "g0_mu0"},
            {"type": "flag_mu", "mu_uid": "g0_mu0", "flagged": False},
        ]
        assert inactive_mus_before(history, 2, UIDS) == []
