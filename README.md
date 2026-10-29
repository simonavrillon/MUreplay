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

MUreplay is a research tool, actively used and actively maintained. We keep
extending it as our own projects need it. If something is awkward or missing,
we would rather hear about it than not.

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
`uv`. Move into the MUreplay folder and install everything MUreplay needs.

On macOS or Linux:

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
is doing, then MUreplay opens in your browser, at <http://127.0.0.1:8000>. The
app runs in that terminal window. When you are finished, quit it there with
`Ctrl+C`, or by closing the window. Closing the browser tab on its own does
**not** quit MUreplay, and nothing is lost if you close it by accident: reopen
<http://127.0.0.1:8000> and carry on where you were.

Two things to know the first time. On macOS, if you downloaded MUreplay rather
than cloning it, macOS will refuse to open the launcher from an unidentified
developer. Right-click **MUreplay.command**, choose **Open**, and confirm once.
Every double-click after that works normally. On Windows, nothing special is
needed. The `.bat` launcher already tells PowerShell to allow this one script,
so you do not have to change any system-wide setting.

If you prefer a terminal, or you are on Linux, the same launchers live in
`scripts/` and can be run directly:

```bash
./scripts/run_MUreplay.sh          # macOS / Linux
.\scripts\run_MUreplay.ps1         # Windows PowerShell
```

## A first session

A session moves through three steps:

1. **Open** — click the folder icon at the top of the rail on the left, unfold a project, a
   participant and a session, and click a trial. MUreplay lists the BIDS projects in its
   `data/` folder; **Open another file…** picks a session saved anywhere else.
2. **Pick a motor unit** — with the **Grid** and **Motor unit** dropdowns, or `<` and `>`. The
   dropdown also shows the units the editor flagged (`✕`), duplicated (`⊕`) or removed (`⊗`).
3. **Step through its edits** — the timeline holds every edit made to the unit, in order and
   coloured by type. Step one at a time, drag the slider, or press play, and watch the
   discharges and the pulse train change.

Most edits are replayed from what MUedit2 recorded. A filter recomputation is rerun on the
original EMG with MUedit2's own algorithm, so you see the filter actually recomputed. Nothing
you do here changes a file.

The [user guide](docs/user-guide.md) covers every control, step type, colour and keyboard
shortcut, and [file formats](docs/file-formats.md) covers which files MUreplay reads and how it
finds them.

## When something goes wrong

If the browser never opens, go to <http://127.0.0.1:8000> manually. Errors show on the status
line under the dropdowns, and the launcher's terminal window shows what reached the server.
[Troubleshooting](docs/troubleshooting.md) lists common symptoms and their fixes: a port already
in use, a file that will not load, a filter step that could not be recomputed. If something is
awkward or missing, please
[open an issue](https://github.com/simonavrillon/MUreplay/issues).

## Command line

`mureplay api` starts the server the launchers start. See the
[command-line reference](docs/cli.md) for it and the environment variables.

## For developers

```bash
uv sync --extra dev
uv run pre-commit install
```

Then start at [AGENTS.md](AGENTS.md): the documentation map, the commands to test and lint,
the rules every change follows, and links to the architecture, contracts and change recipes
in [dev/](dev/).

## License

MUreplay is free software, released under the [GNU General Public License v3.0](LICENSE).

## Acknowledgment

MUreplay is a companion to [MUedit2](https://github.com/simonavrillon/MUedit2), the motor unit
decomposition and editing app; it replays the editing sessions MUedit2 saves.
