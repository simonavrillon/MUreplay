"""Canonical CLI entrypoint for the MUreplay server."""

from __future__ import annotations

import contextlib
import os
import sys
import threading
import time
import webbrowser

import uvicorn

from mureplay.api.app_factory import create_app, mount_frontend
from mureplay.api.routes import include_routers
from mureplay.paths import frontend_dir

_LOOPBACK_HOSTS = ("127.0.0.1", "localhost")
HOST_ENV = "MUREPLAY_HOST"
PORT_ENV = "MUREPLAY_PORT"
OPEN_BROWSER_ENV = "MUREPLAY_OPEN_BROWSER"


def _open_when_started(server: uvicorn.Server, url: str) -> None:
    """Open ``url`` in the browser once ``server`` accepts connections."""
    while not server.started:
        time.sleep(0.1)
    webbrowser.open(url)


def _serve_api() -> None:
    """Start the MUreplay server: the API, and the frontend at ``/`` on the same origin."""
    # The dialog and load routes read any local path, so only this machine's frontend may call them.
    host = os.environ.get(HOST_ENV, "127.0.0.1")
    port = int(os.environ.get(PORT_ENV, "8000"))
    app = create_app(allowed_hosts=_LOOPBACK_HOSTS if host in _LOOPBACK_HOSTS else None)
    include_routers(app)
    frontend = frontend_dir()
    if frontend is not None:
        mount_frontend(app, frontend)
    server = uvicorn.Server(
        uvicorn.Config(app, host=host, port=port, log_level="warning", access_log=False)
    )
    url = f"http://127.0.0.1:{port}/"
    print(f"MUreplay is starting at {url}. Quit with Ctrl+C.", flush=True)
    # A daemon thread, so a server that fails to start does not leave it waiting.
    if os.environ.get(OPEN_BROWSER_ENV) == "1":
        threading.Thread(target=_open_when_started, args=(server, url), daemon=True).start()
    # uvicorn re-raises Ctrl+C after its graceful shutdown; uvicorn.run swallows it the same way.
    with contextlib.suppress(KeyboardInterrupt):
        server.run()


def main() -> None:
    """Dispatch the top-level ``mureplay`` CLI subcommands."""
    if len(sys.argv) < 2 or sys.argv[1] in ("--help", "-h"):
        is_help = len(sys.argv) >= 2
        print("usage: mureplay {api} ...", file=None if is_help else sys.stderr)
        sys.exit(0 if is_help else 2)
    command = sys.argv[1]
    if command == "api":
        _serve_api()
    else:
        print(f"mureplay: unknown command '{command}'", file=sys.stderr)
        sys.exit(2)


if __name__ == "__main__":
    main()
