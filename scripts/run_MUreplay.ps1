#Requires -Version 5.1
# Starts MUreplay from a terminal (Windows) and opens it in the browser; quit with Ctrl+C.
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

if (-not $env:MUREPLAY_OPEN_BROWSER) { $env:MUREPLAY_OPEN_BROWSER = '1' }
uv run --project (Split-Path $PSScriptRoot -Parent) mureplay api
exit $LASTEXITCODE
