"""Replay service: open a decomposition in a server-side replay session, seek it, and filter a grid ahead."""

from __future__ import annotations

from functools import partial
from pathlib import Path
from typing import Any

import numpy as np
from fastapi.responses import Response

from mureplay.api.binary import frame_response
from mureplay.api.cache import get_replay_session, resize_replay_session, store_replay_session
from mureplay.api.memory import DEFAULT_SESSION
from mureplay.api.schemas import ReplayPrepareGridPayload, ReplaySeekPayload
from mureplay.io.bids import read_bids_emg_grid
from mureplay.io.loaders import load_paired_from_path, pack_csr
from mureplay.models import IntArray
from mureplay.replay.session import (
    SESSION_EXPIRED,
    Change,
    ReplayError,
    ReplaySession,
)
from mureplay.storage import SessionStore

#: The loaded fields the page shows and the frame carries as they are.
_META_FIELDS = (
    "source_filename",
    "bids_root",
    "entity_label",
    "fsamp",
    "total_samples",
    "grid_names",
    "artifact_regions",
    "parameters",
    "sidecar_meta",
    "edit_history",
)


def open_replay_session(file_path: str, session: str = DEFAULT_SESSION) -> Response:
    """Open the session paired with ``file_path``: its fields and every MU's discharge times."""
    payload = load_paired_from_path(Path(file_path))
    store = SessionStore.create("replay")
    try:
        replay = ReplaySession(
            store=store,
            total_samples=payload["total_samples"],
            spike_times=payload["spike_times"],
            pulse_trains=payload["pulse_trains"],
            mu_grid_index=payload["mu_grid_index"],
            mu_uids=payload["mu_uids"],
            grid_names=payload["grid_names"],
            history=payload["edit_history"],
            refit_settings=payload["refit_settings"],
            artifact_times=payload["artifact_times"],
            artifact_regions=payload["artifact_regions"],
            bids_grid=partial(
                read_bids_emg_grid, Path(payload["bids_root"]), payload["entity_label"]
            ),
            # An edited file already holds the edits; the replay rewinds them to find its start.
            rewind=not payload["source_filename"].lower().endswith("_decomp.npz"),
        )
    except BaseException:
        store.close()
        raise
    replay.meta = {key: payload[key] for key in _META_FIELDS}
    # Replaces the tab's previous session only now: a file that fails to open leaves it open.
    token = store_replay_session(replay, session)
    with replay.lock:
        _check_open(replay)
        return _state_response(replay, token)


def _expired() -> ReplayError:
    return ReplayError(SESSION_EXPIRED, "token")


def _require_session(token: str, session: str) -> ReplaySession:
    replay = get_replay_session(token, session)
    if replay is None:
        raise _expired()
    return replay


def _check_open(replay: ReplaySession) -> None:
    """Under ``replay.lock``: the 400 ``_require_session`` gives, for a session closed since."""
    if replay.closed:
        raise _expired()


def _spike_arrays(spike_times: list[IntArray]) -> dict[str, tuple[Any, str]]:
    values, offsets = pack_csr(spike_times, np.int32)
    return {"spikes": (values, "i4"), "spike_offsets": (offsets, "i8")}


def _state_response(replay: ReplaySession, token: str) -> Response:
    meta = {
        **replay.meta,
        "token": token,
        "mu_uids": list(replay.mu_uids),
        "mu_grid_index": list(replay.mu_grid_index),
        "versions": list(replay.versions),
    }
    return frame_response(meta, _spike_arrays(replay.spike_times))


def _change_response(replay: ReplaySession, change: Change) -> Response:
    meta = {
        "changed": change.changed,
        "versions": list(replay.versions),
        "refit_errors": change.refit_errors,
    }
    return frame_response(meta, _spike_arrays([replay.spike_times[i] for i in change.changed]))


def seek_replay(payload: ReplaySeekPayload, session: str = DEFAULT_SESSION) -> Response:
    """Move the replay to the steps the page shows; the frame holds what changed."""
    replay = _require_session(payload.token, session)
    with replay.lock:
        _check_open(replay)
        change = replay.seek(payload.steps)
        response = _change_response(replay, change)
    resize_replay_session(payload.token)
    return response


def prepare_replay_grid(payload: ReplayPrepareGridPayload, session: str = DEFAULT_SESSION) -> None:
    """Filter a grid's EMG now, so its first refit does not wait for it; seeks go on."""
    replay = _require_session(payload.token, session)
    replay.prepare_grid(payload.grid)
    resize_replay_session(payload.token)
