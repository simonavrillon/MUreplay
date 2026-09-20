"""Canonical CLI entrypoints for MUreplay web/API server."""

from __future__ import annotations

import os

import uvicorn

from mureplay.api.app_factory import create_app
from mureplay.api.routes import include_routers


def serve_api() -> None:
    """Start the FastAPI backend server."""
    app = create_app(title="MUreplay API", version="1.0.0")
    include_routers(app)
    host = os.environ.get("MUREPLAY_HOST", "0.0.0.0")  # noqa: S104
    port = int(os.environ.get("MUREPLAY_PORT") or os.environ.get("MUREPLAY_BACKEND_PORT", "8000"))
    uvicorn.run(app, host=host, port=port, log_level="warning", access_log=False)


def main() -> None:
    """Dispatch the top-level ``mureplay`` CLI subcommands."""
    import sys

    if len(sys.argv) < 2 or sys.argv[1] in ("--help", "-h"):
        is_help = len(sys.argv) >= 2
        print("usage: mureplay {api} ...", file=None if is_help else sys.stderr)
        sys.exit(0 if is_help else 2)
    command = sys.argv[1]
    if command == "api":
        serve_api()
    else:
        print(f"mureplay: unknown command '{command}'", file=sys.stderr)
        sys.exit(2)


if __name__ == "__main__":
    main()
