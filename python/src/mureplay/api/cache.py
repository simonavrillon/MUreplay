"""The API's cache of replay sessions, counted against one ``MemoryBudget`` and scoped to tabs."""

from __future__ import annotations

from dataclasses import dataclass

from mureplay.api.memory import DEFAULT_SESSION, BudgetedLRU, MemoryBudget, default_budget_bytes
from mureplay.replay.session import ReplaySession


@dataclass
class _ReplaySessionEntry:
    session: ReplaySession

    @property
    def nbytes(self) -> int:
        return self.session.nbytes


def _close_replay_session(entry: _ReplaySessionEntry) -> None:
    entry.session.close()


BUDGET = MemoryBudget(default_budget_bytes())
_REPLAY_SESSIONS: BudgetedLRU[_ReplaySessionEntry] = BudgetedLRU(
    "replay_sessions", BUDGET, per_session=1, on_drop=_close_replay_session
)


def close_session(session: str) -> None:
    """Drop everything ``session`` holds: its tab was closed."""
    BUDGET.close_session(session)


def store_replay_session(replay: ReplaySession, session: str = DEFAULT_SESSION) -> str:
    """Keep a replay session for ``session``, closing the one it replaces; return its token."""
    return _REPLAY_SESSIONS.pin(_ReplaySessionEntry(replay), session)


def get_replay_session(token: str | None, session: str | None = None) -> ReplaySession | None:
    """The replay session for ``token``; with ``session``, it moves to that tab (a reloaded page)."""
    entry = (
        _REPLAY_SESSIONS.get(token) if session is None else _REPLAY_SESSIONS.move(token, session)
    )
    return entry.session if entry is not None else None


def resize_replay_session(token: str) -> None:
    """Recount a replay session's bytes after a seek."""
    _REPLAY_SESSIONS.resize(token)
