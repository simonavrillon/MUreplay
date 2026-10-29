"""Replay operations: a logged step's diff applied to a row, and which MUs a step leaves out."""

from __future__ import annotations

import math
from collections.abc import Sequence
from typing import Any

import numpy as np

from mureplay.models import IntArray
from mureplay.replay.filter_update import spike_array


def step_type(entry: dict[str, Any]) -> str:
    """A step's ``type``, lower-cased; ``unknown`` when the log gives none."""
    return str(entry.get("type") or "unknown").lower()


def is_artifact_step(entry: dict[str, Any]) -> bool:
    """Whether a step edits artifact markers rather than discharges."""
    return step_type(entry) in ("add_artifact", "delete_artifact")


def sample_array(raw: Any) -> IntArray:
    """A sample list from the user's log as ``spike_array``; what is not a number is skipped, as the page skips it."""
    values = raw if isinstance(raw, list) else []
    return spike_array(
        [
            v
            for v in values
            if isinstance(v, int | float) and not isinstance(v, bool) and math.isfinite(v)
        ]
    )


def apply_diff(row: IntArray, added: IntArray, removed: IntArray) -> IntArray:
    """``row`` with ``removed`` taken out and then ``added`` put in: sorted, unique and non-negative."""
    return spike_array(np.union1d(np.setdiff1d(row, removed), added))


def inactive_mus_before(
    history: Sequence[dict[str, Any]], step: int, mu_uids: Sequence[str]
) -> list[int]:
    """The MUs flagged or removed before ``history[step]``, which MUedit2 leaves out of a peel-off."""
    # Any other edit to a flagged MU clears its flag, as it does in MUedit2's session.
    flagged: set[str] = set()
    removed: set[str] = set()
    for entry in history[:step]:
        kind = step_type(entry)
        uid = str(entry.get("mu_uid") or "")
        if kind in ("remove_flagged", "remove_duplicates"):
            raw = entry.get("removed_mu_uids")
            if isinstance(raw, list):
                removed.update(str(u) for u in raw)
        elif not uid:
            continue
        elif kind == "flag_mu" and entry.get("flagged") is not False:
            flagged.add(uid)
        else:
            flagged.discard(uid)
    return sorted(mu_uids.index(uid) for uid in flagged | removed if uid in mu_uids)
