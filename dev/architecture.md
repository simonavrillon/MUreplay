# Architecture

How MUreplay is put together, and the decisions behind its shape. The code holds the details
(signatures, fields, defaults); this page gives you the map to read it with. Wire formats are in
[contracts.md](contracts.md), change playbooks in [recipes.md](recipes.md).

## One process, one origin

`mureplay api` (`cli.py`) starts one FastAPI server that serves the API under `/api/v1` and
`frontend/` at `/`. Because the page and the API share one origin there is no CORS, and when the
server is bound to loopback a `TrustedHostMiddleware` rejects DNS-rebound requests: the open
route and the folder dialog read any local path. The frontend has no build step: the browser
loads `frontend/app.js` as an ES module.

## What a replay is

MUedit2 saves an edited decomposition as a pair: the `.npz` and an `_edited.json` edit log, the
history of every edit made in the session. MUreplay opens the decomposition MUedit2 started
from and plays that history forward on it, one step at a time.

```text
pick a trial ──> open + pair (server) ──> start the replay ──> step forward / back
                 _decomp.npz + _edited.json   timeline of the      /replay/seek: logged diffs,
                 a replay session, its token  current MU's steps   or a refit (update_filter)
```

| Part | Frontend | Backend |
|---|---|---|
| Open | `app/services/file-session.js`, `state/transitions.js`, `view/project-tree.js`, `view/settings-renderer.js` | `routes/projects.py`, `io/projects.py`, `routes/dialog.py`, `routes/replay.py`, `services/replay_service.py`, `io/loaders.py`, `io/npz.py`, `io/bids.py: read_sidecar_meta` |
| Replay | `app/services/replay-service.js`, `replay/operations.js` | `replay/session.py`, `replay/operations.py` |
| Refit | — | `replay/session.py: _refit`, `replay/filter_update.py`, `io/bids.py` |
| Draw | `view/replay-renderer.js`, `view/plots.js` (MUedit2's `drawTrace`) | `routes/series.py`, `services/series_service.py`, `replay/series.py` |

## The server replays; the page holds a window

This is MUedit2's shape. Opening a trial opens a `ReplaySession` (`replay/session.py`, the
counterpart of MUedit2's `EditSession`) on the server, which answers with its token, the
per-MU fields and every MU's discharge times. Full-length arrays (pulse trains, EMG) never
cross to the browser: the page asks for the window it draws (`/series/pulse`), a min/max
envelope sized to the canvas, or the samples when zoomed in far enough. Arrays cross as MUB1
frames, never as JSON lists ([contracts.md](contracts.md#mub1-frames)).

Moving the playhead is one request: the page sends the steps of the edit log the replay should
hold (`/replay/seek`), the server undoes and applies steps until it holds exactly those, and
answers with what changed: the discharges of the MUs it moved, and every MU's version. A new
version makes the page fetch that MU's window again.

Almost every step is replayed from what the log recorded: `add_spikes`, `delete_spikes` and the
other spike edits carry the discharges they added and removed, and artifact steps the markers.
The diff is applied; nothing is recomputed, so these steps match the session by construction.

`update_filter` is the exception. MUedit2 logs the window and flags (`use_peeloff`,
`lock_spikes`) and the diff it produced, and MUreplay recomputes the step on the BIDS EMG, so a
reviewer sees the filter actually rerun. If the refit fails (the EMG has moved, say), the
server applies the step's logged diff instead and names the step in `refit_errors`, and the
page says so in the status.

Decisions worth knowing before changing this area:

- **The refit is a mirror, not a port.** `replay/filter_update.py` is MUedit2's refit, kept
  identical down to the order of float operations, so a replayed step lands on the saved
  result exactly. `tests/test_muedit2_parity.py` runs both side by side and replays MUedit2's
  sample session end to end. Change it only by porting MUedit2's code
  ([recipes.md](recipes.md#follow-a-muedit2-change)).
- **The refit filters as the session did.** MUedit2 notches and bandpasses a grid once, whole
  (the FFT notch can't run on a window), and refits windows of that. The session does the same,
  once per grid, into its store (`_filter_grid`), with the grid's bandpass (surface or
  intramuscular) chosen from its name as MUedit2's grid catalogue would. The page asks for it
  ahead (`/replay/session/prepare-grid`) when the MU it shows has a refit, so the first refit
  doesn't wait.
- **Peel-off follows the session.** MUedit2 subtracts the other *live* MUs of the grid: flagged
  and removed ones are left out. The session works out which MUs were flagged or removed at the
  step being replayed (`replay/operations.py: inactive_mus_before`).
- **The replay starts where the edits did.** When no `_decomp.npz` is beside the log, the
  session opens the `_edited.npz` and undoes the logged diffs, last first, to find step 0
  (`ReplaySession._rewind`); the service decides which from the file's name.
- **Undo restores, it doesn't recompute.** Every step applied forward pushes the MU's rows on
  the undo stack; stepping back pops them. A refit writes the MU a new pulse-train row in the
  store, and undoing it goes back to the row before (and deletes the refit's). A refit is
  therefore never rerun to go backwards.
- **One seek at a time.** A refit takes over a second while the play timer and a slider drag
  fire faster, so a seek requested mid-flight parks its target and the running one picks up
  the newest when it finishes (`seekReplayPosition`).

## Sessions, memory and disk

As in MUedit2. Each browser tab sends a session id (`X-MUreplay-Session`); a replay session
belongs to the tab that opened it, one per tab, and `/session/close` (sent on `pagehide`) drops
it.

- **Pulse trains are mapped, not read.** MUedit2 writes its `.npz` uncompressed with each array
  aligned, so `io/npz.py: NpzArchive.memmap` maps `pulse_trains` straight from the file; the OS
  pages in only what a window reads. A compressed file is read whole instead.
- **Session stores** (`storage.py`, MUedit2's): a folder of memory-mapped `.npy` files under
  `<cache dir>/sessions/`, one per replay session, holding its filtered grids and the pulse
  trains its refits wrote. When the disk is nearly full (less than 1 GB free), arrays stay on
  the heap instead. Folders of exited processes are purged at startup.
- **One budget** (`api/memory.py`, `api/cache.py`, MUedit2's): the replay sessions are a
  `BudgetedLRU` under a `MemoryBudget` (10% of RAM, 256 MB–1 GB). Only heap bytes count;
  memory-mapped arrays are free. The active tab's session is never evicted; idle tabs close
  after 20 minutes.

## The timeline

The timeline shows the steps that touch the current MU. A run of consecutive spike edits on one
MU is merged into one timeline step (`rebuildReplayGroups`); every other step is its own.
Steps of MUs that the log removed and the file no longer holds are left out.

MUedit2 names MUs in the log by uid (`g<grid>_mu<n>`). When the edit log's uid list no longer
matches the decomposition (MUs were removed before saving), the loader numbers the
decomposition's MUs as MUedit2 did when the session opened (`replay/session.py:
initial_mu_uids`).

## Backend layers

```text
api/routes  ──>  api/services  ──>  io  ──>  replay
                          (all over errors, paths, models, storage)
```

Each layer imports only the layers to its right. `api/` holds everything HTTP: request models
(`schemas.py`), the envelope and session header (`common.py`), error handlers (`errors.py`),
MUB1 frames (`binary.py`), the cache and its budget, the services. The
domain packages know nothing of HTTP and raise `MureplayError` for anything the user can fix.

## Frontend shape

- **One context.** `app/create-app.js` merges every service factory (ui, file session, replay)
  into one `app` object typed by `App` in `app/context.js`. A factory reads only `state`, `els`
  and `api` while it is constructed; it reaches other services as `app.x()` inside function
  bodies.
- **What goes on `app`.** Only what another module calls through it (the stages, the container,
  the file session). Selectors and pure helpers are imported where used.
- **State.** One `state` object (`state/state.js`). Mutations go through `state/actions.js`;
  derived reads through `state/selectors.js`; opening a session resets state through
  `state/transitions.js`.
- **Stages bind input; views draw.** `app/stages/` wires controls, shortcuts and the timeline
  bar's drag to the services; `view/` modules only draw the state they're given.
- **Types.** `tsc --checkJs` in `strict` mode over JSDoc annotations. Backend JSON enters typed
  as `JsonObject` and is normalised at the boundary (`api/payloads.js`); frames are decoded in
  `api/binary-payloads.js`.
