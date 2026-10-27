"""Errors the user can fix: the API answers them with their status and message."""

from __future__ import annotations


class MureplayError(ValueError):
    """An error whose message is safe to show and says what to change."""

    field: str | None = None  # the request field at fault, when one is
    status = 400  # the HTTP status the API answers it with

    def __init__(self, message: str, field: str | None = None) -> None:
        super().__init__(message)
        if field is not None:
            self.field = field


class NotFoundError(MureplayError):
    """A file the request names that is not there."""

    status = 404
