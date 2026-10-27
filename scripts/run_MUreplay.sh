#!/usr/bin/env bash
# Starts MUreplay from a terminal (macOS, Linux) and opens it in the browser; quit with Ctrl+C.
set -euo pipefail

export MUREPLAY_OPEN_BROWSER="${MUREPLAY_OPEN_BROWSER:-1}"
exec uv run --project "$(cd "$(dirname "$0")/.." && pwd)" mureplay api
