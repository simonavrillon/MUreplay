# MUreplay — agent & contributor guide

MUreplay replays a motor unit editing session saved by [MUedit2](https://github.com/simonavrillon/MUedit2),
step by step, on an interactive timeline. It is a **local** browser app: a Python backend
(FastAPI) serves a vanilla-JS frontend, and the computation runs on your machine. Nothing is
uploaded.

This file is the entry point for anyone (or any agent) working in this repository: a
documentation map, the repository layout, the commands to run, test, and lint, and the rules
every change follows. End-user docs live in `docs/`; developer docs in `dev/`. Each code area
has its own `AGENTS.md` with its conventions; read it before editing there.

## Documentation map

| Doc | Audience | What it's for |
|---|---|---|
| [README.md](README.md) | everyone | what MUreplay is, install, launch, a first session |
| [CHANGELOG.md](CHANGELOG.md) | everyone | what changed in each release |
| [docs/user-guide.md](docs/user-guide.md) | app users | every control, step type, colour and shortcut |
| [docs/file-formats.md](docs/file-formats.md) | analysing sessions | the files MUreplay reads and how they are paired |
| [docs/cli.md](docs/cli.md) | scripters | `mureplay api`; environment variables |
| [docs/troubleshooting.md](docs/troubleshooting.md) | anyone stuck | symptom/fix |
| [dev/architecture.md](dev/architecture.md) | contributors | how the pieces fit, and why: one origin, the replay, the refit mirror, layers |
| [dev/contracts.md](dev/contracts.md) | contributors | what both sides of a boundary rely on: HTTP, the edit log, parity with MUedit2 |
| [dev/recipes.md](dev/recipes.md) | contributors | checklists for common changes: a route, a step type, following a MUedit2 change |
| [python/src/mureplay/AGENTS.md](python/src/mureplay/AGENTS.md) | contributors | backend conventions |
| [frontend/AGENTS.md](frontend/AGENTS.md) | contributors | frontend conventions |
| [tests/AGENTS.md](tests/AGENTS.md) | contributors | pytest conventions and helpers |

## Repository layout

```text
python/src/mureplay/   backend
  api/                 HTTP routes, schemas, services (filter refit, file dialog), app factory
  io/                  BIDS EMG reader, decomposition + edit-log loading and pairing
  replay/              the update_filter refit (a mirror of MUedit2's), artifact masks
frontend/              vanilla JS app (no framework)
  src/app/             context, services (file session, replay, ui), stages
  src/state/           state, actions, selectors, transitions
  src/view/            renderers (plots, replay-renderer)
  src/api/             client, routes, http, payloads
  src/replay/          operations: logged diffs and step predicates
  src/signal/          series: the range a plot scales to
  index.html           the page
tests/                 pytest suite (backend), including the parity tests against MUedit2
frontend/tests/        node --test suite
scripts/               run_MUreplay.sh / run_MUreplay.ps1 (the launchers)
data/                  sample BIDS datasets for the full suite (gitignored)
```

## Environment & tooling

Setup is in the [README](README.md). Everything runs through [uv](https://docs.astral.sh/uv/)
(`uv run …`; nothing to activate):

```bash
uv sync --extra dev              # locked environment + pytest, ruff, mypy, pre-commit
uv run pre-commit install        # commit hooks
```

`uv.lock` is committed and CI runs with `--locked`: after editing dependencies in
`pyproject.toml`, run `uv lock` and commit both.

The parity tests import MUedit2 from a sibling checkout (`../MUedit2`, or `MUEDIT2_ROOT`);
without it they skip.

## Run

```bash
./MUreplay.command               # macOS (double-click), or scripts/run_MUreplay.sh
MUreplay.bat                     # Windows (double-click), or scripts/run_MUreplay.ps1
uv run mureplay api              # the server — http://127.0.0.1:8000
```

The launchers run `uv run mureplay api` with `MUREPLAY_OPEN_BROWSER=1`, so the server opens
the browser at `http://127.0.0.1:8000/` once it is listening. The app runs in the launcher's
terminal — quit with `Ctrl+C`. See [docs/cli.md](docs/cli.md) for every environment variable.

## Test

```bash
uv run pytest                     # full suite (needs data/Test and MUedit2's data/Test)
uv run pytest -m "not data"       # the tier CI runs, no recordings required
```

The `data` pytest marker marks tests that need the sample datasets; see
[tests/AGENTS.md](tests/AGENTS.md).

## Lint & typecheck

```bash
uv run ruff check . && uv run ruff format .
uv run mypy
```

Frontend (Node 20 or later):

```bash
cd frontend
npm ci
npm run check                     # eslint, prettier --check, tsc, node --test
```

## Rules for every change

- **Simplest change that works.** Fix in place; no new abstractions, options or guard tests
  beyond what the change needs.
- **Same concept, same name** across modules, across the backend/frontend boundary, and with
  MUedit2 (`fsamp`, `grid_names`, `mu_grid_index`, `mu_uid`, `peel_off_win`). Grep before naming.
- **Python docstrings are one line; each JS module opens with a comment stating its role.**
  Beyond that, comments say only what the code can't (a spec rule, a unit fact, an ordering
  constraint, why a constant has its value).
- **Change both sides of a contract together.** Routes and their payloads are listed in
  [dev/contracts.md](dev/contracts.md).
- **MUedit2 is the reference.** The refit in `replay/filter_update.py` mirrors MUedit2's
  bit for bit, and the edit log is MUedit2's format: follow it, don't extend it. When the
  parity tests fail, port MUedit2's change (see [dev/recipes.md](dev/recipes.md)).
- **Never touch** the sample data under `data/`; don't hand-edit `uv.lock` (run `uv lock`) or
  `frontend/package-lock.json`.
- **No new dependencies without asking**, backend or frontend (which has no runtime
  dependencies at all). Use NumPy, SciPy and the standard library, or write the few lines.
- **User-facing text is plain sentences** that say what happened and what to do next. Error
  messages reach users verbatim: no internals, class names or tracebacks.

## Commits

- Subject: an imperative sentence, sentence case, no prefix (`feat:`), no full stop. Join two
  changes with ", and": *Serve the page from the API server, and slim the launchers to uv run*.
- Body: prose saying what changed and why, wrapped at ~72 columns; bullets only for a long list.
- One logical change per commit, with its docs and tests.
- A user-visible change adds a line under `## [Unreleased]` in [CHANGELOG.md](CHANGELOG.md),
  in the same commit. Internal refactors, tests and dev docs don't.

## Glossary

Use these terms in code, UI text and docs alike. MUedit2's terms carry over unchanged. Python
names and JSON keys are snake_case; the frontend writes the same name in camelCase
(`spike_times` → `spikeTimes`).

| Term | Meaning | In code |
|---|---|---|
| MU, motor unit | one decomposed source | `mu`, `n_mu` |
| discharge times | the samples an MU fires at (say "discharges" in docs and UI) | `spike_times` (one array per MU), `spikes` (one MU's array) |
| recording length | samples in the whole recording, or in the array at hand | `total_samples`, `n_samples` |
| pulse train (IPT) | an MU's source signal, from which discharges are picked | `pulse_trains` |
| grid | one electrode array; a recording can hold several | `grid_names`, `mu_grid_index` |
| BIDS dataset | the dataset a session belongs to, holding the raw EMG | `bids_root` |
| entity label | the BIDS name of a recording, such as `sub-1_ses-1_task-x_run-1` | `entity_label` |
| uid | an MU's stable id in the edit log, numbered per grid | `mu_uid` (`g<grid>_mu<n>`) |
| edit log | the `_edited.json` beside a decomposition: MUedit2's history | `edit_history` (its key in the file: `history`) |
| step | one entry of the edit log | `EditLogEntry` |
| timeline step | what the timeline shows: a step, or a run of spike edits on one MU merged | `ReplayGroup` |
| refit | replaying an `update_filter` step on the BIDS EMG | `run_update_filter` |
| replay base | the decomposition the replay starts from, at step 0 | `replayBase*` |
| artifact window | a time range excluded from the decomposition | `artifact_regions`, `artifact_intervals` |
| artifact marker | a peak marked as an artifact on one MU | `artifacts`, `artifact_times` |

## Before you finish

1. `uv run ruff check . && uv run ruff format .` and `uv run mypy`
2. `uv run pytest -m "not data"` (or the files for the area you touched)
3. `cd frontend && npm run check`, if you touched `frontend/`
4. Docs: update the one home of anything user-visible you changed (below), in the same commit.
   Update `dev/` only when a contract, a layer rule or a recipe changed; never copy code into it.

## Documentation conventions

- **One home per fact.** UI labels, shortcuts and step types → `docs/user-guide.md`;
  file formats and pairing → `docs/file-formats.md`; the command and environment variables →
  `docs/cli.md`; symptoms → `docs/troubleshooting.md`; architecture, contracts and change
  recipes → `dev/`; code conventions → the area's `AGENTS.md`. Cross-link; never duplicate.
- **`dev/` holds what the code can't say**: decisions, cross-file contracts, multi-file
  checklists. Signatures, field lists and defaults stay in the code, where they can't go stale.
- **bold** = an exact UI label (it matches the app and `frontend/index.html`).
  `` `backticks` `` = a file path, key, CLI command, or environment variable.
- Tables are reference; prose is orientation. Tips and warnings are blockquotes.
