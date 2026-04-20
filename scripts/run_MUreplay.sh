#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
BACKEND_DIR="$ROOT_DIR/python"
FRONTEND_DIR="$ROOT_DIR/frontend"

export MUREPLAY_HOST="${MUREPLAY_HOST:-0.0.0.0}"
export MUREPLAY_BACKEND_PORT="${MUREPLAY_BACKEND_PORT:-8000}"
export MUREPLAY_FRONTEND_PORT="${MUREPLAY_FRONTEND_PORT:-8080}"
export MUREPLAY_OPEN_BROWSER="${MUREPLAY_OPEN_BROWSER:-1}"
MUREPLAY_BIDS_ROOT="${1:-${MUREPLAY_BIDS_ROOT:-}}"

BACKEND_HOST_FOR_URL="$MUREPLAY_HOST"
if [[ "$BACKEND_HOST_FOR_URL" == "0.0.0.0" || "$BACKEND_HOST_FOR_URL" == "::" ]]; then
  BACKEND_HOST_FOR_URL="127.0.0.1"
fi

# Resolve Python: prefer the MUreplay conda env, fall back to python3.
CONDA_PYTHON="$(conda run -n MUreplay which python 2>/dev/null || true)"
PYTHON="${CONDA_PYTHON:-python3}"
echo "Using Python: $PYTHON"

"$PYTHON" - <<PY
from pathlib import Path

template = Path("$FRONTEND_DIR/runtime-config.template.js").read_text(encoding="utf-8")
rendered = (
    template
    .replace("__MUREPLAY_API_BASE__", "http://${BACKEND_HOST_FOR_URL}:${MUREPLAY_BACKEND_PORT}")
    .replace("__MUREPLAY_BIDS_ROOT__", "${MUREPLAY_BIDS_ROOT}")
)
Path("$FRONTEND_DIR/runtime-config.js").write_text(rendered, encoding="utf-8")
PY

cd "$BACKEND_DIR"
"$PYTHON" server.py --host "$MUREPLAY_HOST" --port "$MUREPLAY_BACKEND_PORT" ${MUREPLAY_BIDS_ROOT:+--bids-root "$MUREPLAY_BIDS_ROOT"} &
BACK_PID=$!
echo "Backend started (PID $BACK_PID) on :$MUREPLAY_BACKEND_PORT"

cd "$FRONTEND_DIR"
"$PYTHON" -m http.server "$MUREPLAY_FRONTEND_PORT" >/dev/null 2>&1 &
FRONT_PID=$!
echo "Frontend started (PID $FRONT_PID) on :$MUREPLAY_FRONTEND_PORT"

cleanup() {
  echo "Stopping MUreplay..."
  [[ -n "${FRONT_PID:-}" ]] && kill "$FRONT_PID" >/dev/null 2>&1 || true
  [[ -n "${BACK_PID:-}" ]] && kill "$BACK_PID" >/dev/null 2>&1 || true
}
trap cleanup EXIT INT TERM

if [[ "$MUREPLAY_OPEN_BROWSER" == "1" ]]; then
  sleep 2
  "$PYTHON" - <<PY
import os
import webbrowser

host = os.environ.get("MUREPLAY_HOST", "127.0.0.1")
port = os.environ.get("MUREPLAY_FRONTEND_PORT", "8080")
url_host = "127.0.0.1" if host in {"0.0.0.0", "::"} else host
webbrowser.open(f"http://{url_host}:{port}/")
PY
fi

wait "$BACK_PID" >/dev/null 2>&1 || true
wait "$FRONT_PID" >/dev/null 2>&1 || true
