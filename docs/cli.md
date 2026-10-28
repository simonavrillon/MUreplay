# MUreplay Command Line

MUreplay has one command: `mureplay api` starts the server the app runs on. The launchers
(`MUreplay.command`, `MUreplay.bat`, `scripts/run_MUreplay.*`) run it for you; you need it only
to start MUreplay from a terminal yourself.

Run it through `uv` from the project folder, or directly if MUreplay is installed:

```bash
uv run mureplay api          # from the MUreplay folder
mureplay api                 # when the package is installed
```

Running `mureplay` with no arguments prints usage and exits with code 2; an unknown command
also exits 2.

---

## `mureplay api`

Starts the MUreplay server: the API under `/api/v1` and the app at `/` on the same origin, at
`http://127.0.0.1:8000/` by default. It takes **no flags**; quit it with `Ctrl+C`.

## Environment variables

| Environment variable | Default | Effect |
|---|---|---|
| `MUREPLAY_HOST` | `127.0.0.1` | Bind host. A loopback host enables a Host-header check so only this machine's browser can call the API. Set `0.0.0.0` to open MUreplay from other machines on your network; the check is then off. |
| `MUREPLAY_PORT` | `8000` | Bind port, for the launchers too. The app opens at `http://127.0.0.1:<port>/`. |
| `MUREPLAY_OPEN_BROWSER` | `0` (`1` in the launchers) | `1` opens the app in the browser once the server is listening. |
| `MUREPLAY_DATA_ROOT` | `data/` in the MUreplay folder | The BIDS dataset filter steps read the EMG from when the opened file's location names none (see [file-formats.md](file-formats.md#where-the-emg-comes-from)). |

For example, to run on another port:

```bash
MUREPLAY_PORT=8100 ./scripts/run_MUreplay.sh            # macOS / Linux
$env:MUREPLAY_PORT = "8100"; .\scripts\run_MUreplay.ps1  # Windows PowerShell
```
