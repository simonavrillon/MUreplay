"""Viewport series as MUB1 frames: a replay session's pulse trains, at the resolution drawn."""

from __future__ import annotations

from typing import Any

import numpy as np
from fastapi.responses import Response

from mureplay.api.binary import frame_response
from mureplay.api.cache import get_replay_session
from mureplay.models import IntArray
from mureplay.replay.series import SeriesView, envelope
from mureplay.replay.session import SESSION_EXPIRED, ReplayError

MAX_BINS = 8192


def _series_frame(
    series: SeriesView,
    meta: dict[str, Any],
    arrays: dict[str, tuple[Any, str]],
    bins: int,
    total_samples: int,
) -> Response:
    """The frame of ``series`` with ``meta`` and ``arrays``: its ``samples``, or ``min`` and ``max``."""
    meta.update(
        start=series.start,
        end=series.end,
        bins=bins,
        factor=series.factor,
        total_samples=total_samples,
    )
    if series.samples is not None:
        meta["kind"] = "samples"
        arrays["samples"] = (series.samples, "f4")
    else:
        meta["kind"] = "envelope"
        arrays["min"] = (series.mins, "f4")
        arrays["max"] = (series.maxs, "f4")
    return frame_response(meta, arrays)


def _clamp_window(total_samples: int, start: int, end: int) -> tuple[int, int]:
    s = max(0, min(int(start), total_samples))
    return s, total_samples if end <= 0 else max(s, min(int(end), total_samples))


def _in_view(times: IntArray, start: int, end: int) -> IntArray:
    lo, hi = np.searchsorted(times, [start, end])
    return times[lo:hi]


def pulse_frame(token: str, mu: int, start: int, end: int, bins: int) -> Response:
    """``[start, end)`` of an MU's pulse train, as samples or an envelope, with its discharges and artifacts."""
    replay = get_replay_session(token)
    if replay is None:
        raise ReplayError(SESSION_EXPIRED, "token")
    with replay.lock:
        if replay.closed:
            raise ReplayError(SESSION_EXPIRED, "token")
        replay.check_mu(mu)
        total_samples = replay.total_samples
        s, e = _clamp_window(total_samples, start, end)
        series = envelope(lambda a, b: replay.values(mu, a, b), s, e, bins)
        spikes = _in_view(replay.spike_times[mu], s, e)
        artifacts = _in_view(replay.artifact_times[mu], s, e)
        # ``version`` changes with every step that moves the MU, so the page caches frames by it.
        meta: dict[str, Any] = {"mu": mu, "version": replay.versions[mu]}
        arrays: dict[str, tuple[Any, str]] = {
            "spikes": (spikes, "i4"),
            "spike_values": (replay.values_at(mu, spikes), "f4"),
            "artifacts": (artifacts, "i4"),
            "artifact_values": (replay.values_at(mu, artifacts), "f4"),
        }
        return _series_frame(series, meta, arrays, bins, total_samples)
