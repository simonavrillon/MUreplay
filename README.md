# MUreplay

Load a decomposition that was edited in MUedit2 and
MUreplay replays the editing session step by step on an interactive timeline,
so you can watch the motor units take their final shape one edit at a time.

It is built for the situations where the editing itself matters: checking the
work of a student or a colleague in a collaborative project, or reviewing the
edited decompositions behind a paper from another group.

It runs as a small app in your browser. Nothing is uploaded anywhere: the
interface is a local web page, the computation happens on your own machine, and
your recordings and results stay in the folders you choose.

MUreplay is a research tool, actively used and actively maintained. It works,
and we keep extending it as our own projects need it to do more. If something
is awkward or missing, we would rather hear about it than not.

## Before your first run

You need one thing installed: [uv](https://docs.astral.sh/uv/), a Python
project manager. It downloads its own copy of Python, so you do not need to
have Python set up, and it will not touch anything else on your system.

On macOS or Linux, open a terminal and run:

```bash
curl -LsSf https://astral.sh/uv/install.sh | sh
```

On Windows, open PowerShell and run:

```powershell
powershell -c "irm https://astral.sh/uv/install.ps1 | iex"
```

Then close that window and open a new one, so it picks up the freshly installed
`uv`. Move into the MUreplay folder and install everything MUreplay needs:

```bash
cd path/to/MUreplay
uv sync
```

On Windows (PowerShell):

```powershell
cd path\to\MUreplay
uv sync
```

This reads a locked list of exact package versions, so you get the same working
setup as everyone else, and it only has to be done once. It takes a couple of
minutes the first time.

## Starting the app

Open the MUreplay folder and double-click **MUreplay** — `MUreplay.command` on
macOS, `MUreplay.bat` on Windows. A terminal window appears and reports what it
is doing; leave it open, because that window *is* MUreplay running.

Your browser should open on MUreplay's landing page by itself. If it does not,
go to <http://localhost:8080> — the app is already running and waiting for you.

When you are finished, quit MUreplay from that terminal window rather than the
browser: press `Ctrl+C` in it, or simply close the window. Either one stops the
app cleanly. Closing the browser tab on its own does **not** quit MUreplay —
the tab is only a window onto the app, which keeps running in the background
and holding on to its ports. If you close the tab by accident, nothing is
lost: reopen <http://localhost:8080> and carry on where you were.

Two things to know the first time. On macOS, if you downloaded MUreplay rather
than cloning it, macOS will refuse to open the launcher from an unidentified
developer; right-click **MUreplay.command**, choose **Open**, and confirm once.
Every double-click after that works normally. On Windows, nothing special is
needed — the `.bat` launcher already tells PowerShell to allow this one script,
so you do not have to change any system-wide setting.

If you prefer a terminal, or you are on Linux, the same launchers live in
`scripts/` and can be run directly:

```bash
./scripts/run_MUreplay.sh          # macOS / Linux
.\scripts\run_MUreplay.ps1         # Windows PowerShell
```

## Replaying an editing session

A session in MUreplay moves through three stages: open the edited
decomposition, pick a motor unit, then step through the edits that were made
to it.

### Opening the files

Click **Load** and pick the decomposition file — the `.npz` that MUedit2 saved.
In recent MUedit2 versions these live under
`<bids_root>/derivatives/muedit/sub-XX/[ses-YY]/decomp/`; older sessions keep
them under `<bids_root>/sub-XX/decomp/`, and MUreplay reads both. From the
filename it works out which recording the file belongs to, finds the matching
`_edited.json` sidecar next to it — that sidecar is the edit history MUreplay
will replay — and locates the original EMG recording in the dataset.

The EMG matters for one thing only: when the editor recomputed a unit's filter
(a common and powerful edit), MUreplay reruns that same computation against
the original signal. If the EMG file has moved or is missing, everything else
still replays; the filter steps are simply skipped and the discharge times
stay as they were at that point.

### Picking a motor unit

Use the **Grid** and **Motor Unit** dropdowns, or `<` and `>`, to move between
units. Each unit shows its firing rate over time on top and its pulse train
underneath. The dropdowns also carry the marks the editor left: a `✕` prefix
means the unit was flagged for deletion, `⊕` that it was created as a
duplicate, and `⊗` that it was later removed. Removed and duplicated units
are greyed out — they are listed so you can see what happened, but hold no
replay of their own.

### Stepping through the edits

The timeline at the bottom shows the edits that touch the unit you are looking
at, in the order they were made. **Prev** and **Next** step one edit at a time,
the slider jumps anywhere directly, and **Play** advances through them on its
own. The status bar always says what the current step did: which spikes were
added or removed, over what time range.

Each step type keeps its colour: green for added discharges, red for deleted
ones, blue for a filter recomputation, orange for artifact markers. Move
around the pulse train with the arrow keys — left and right to scroll, up and
down to zoom — and `Space` to play or pause.

Nothing you do here changes anything on disk. MUreplay is a viewer: it rebuilds
the session from the recorded history, so you can step backward and forward
as much as you like and the saved files are never touched.

## When something goes wrong

If the browser never opens, go to <http://localhost:8080> manually. If the
launcher complains that a port is already in use, something else on your
machine has taken it — set `MUREPLAY_BACKEND_PORT` or
`MUREPLAY_FRONTEND_PORT` to free numbers and relaunch. If the app tells you
the backend is unreachable, the Python process behind the interface has
stopped; close the terminal and run the launcher again. To check whether the
backend is alive at all, visit
<http://localhost:8000/api/v1/health> in your browser.

If a file will not load, check that it is the `.npz` MUedit2 saved and that the
`_edited.json` sidecar really is sitting next to it. If filter steps are being
skipped, the original EMG recording is no longer where it was when the session
was edited — point `MUREPLAY_DATA_ROOT` at the dataset root to fix that. And
if the timeline shows no steps, the log may simply be empty, or the unit you
selected may not have been edited.

## Learning more

The [user guide](docs/user-guide.md) covers every control, colour, and keyboard
shortcut in detail — read it when you want to know exactly what a step type
does. [File formats](docs/file-formats.md) documents the contents of the
`.npz` and `_edited.json` files MUreplay reads, which is what you want when
you start inspecting edit histories in your own scripts.

MUreplay also has a command-line entry point, for scripting and batch work:
`mureplay-api` starts just the backend, without the interface.

## For developers

Install the development tooling and enable the commit hooks:

```bash
uv sync --extra dev
uv run pre-commit install
```

`uv run` executes inside the project environment, so there is nothing to
activate:

```bash
uv run pytest          # backend tests
uv run mypy            # backend type checks
uv run ruff check .    # backend lint
```

The frontend is plain ES-module JavaScript with no build step — the browser
loads `frontend/app.js` directly. It is checked with the usual Node tooling:

```bash
cd frontend
npm ci
npm run check           # eslint + prettier + tsc
```

The two services can also be run manually, in separate terminals:

```bash
uv run python -m mureplay.cli api   # backend, http://localhost:8000
```

```bash
cd frontend && python -m http.server 8080   # frontend, http://localhost:8080
```

## Acknowledgment

MUreplay is a companion to MUedit for high-density EMG decomposition; it
replays the editing sessions produced by MUedit2.
