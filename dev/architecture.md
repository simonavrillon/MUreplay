# Architecture

How MUreplay is put together, and the decisions behind its shape. The code holds the details
(signatures, fields, defaults); this page gives you the map to read it with. Wire formats are in
[contracts.md](contracts.md), change playbooks in [recipes.md](recipes.md).

## One process, one origin

`mureplay api` (`cli.py`) starts one FastAPI server that serves the API under `/api/v1` and
`frontend/` at `/`. Because the page and the API share one origin there is no CORS, and when the
server is bound to loopback a `TrustedHostMiddleware` rejects DNS-rebound requests: the load
route and the file dialog read any local path. The frontend has no build step: the browser
loads `frontend/app.js` as an ES module.

## What a replay is

MUedit2 saves an edited decomposition as a pair: the `.npz` and an `_edited.json` edit log, the
history of every edit made in the session. MUreplay opens the decomposition MUedit2 started
from and plays that history forward on it, one step at a time.

```text
pick a file ──> load + pair (backend) ──> start the replay ──> step forward / back
               _decomp.npz + _edited.json   timeline of the      logged diff, or a refit
                                            current MU's steps   on the server (update_filter)
```

| Part | Frontend | Backend |
|---|---|---|
| Open | `app/services/file-session.js`, `state/transitions.js`, `view/settings-renderer.js` | `routes/dialog.py`, `routes/replay.py`, `io/loaders.py`, `io/bids.py: read_sidecar_meta` |
| Replay | `app/services/replay-service.js`, `replay/operations.js` | — |
| Refit | `replay-service.js: refitStep` | `routes/editing.py`, `services/filter_service.py`, `replay/filter_update.py`, `io/bids.py` |
| Draw | `view/replay-renderer.js`, `view/plots.js` (MUedit2's `drawTrace`) | — |

## The page replays; the server refits

Almost every step is replayed in the browser from what the log recorded: `add_spikes`,
`delete_spikes` and the other spike edits carry the discharges they added and removed, and
artifact steps the markers. The page applies the diff; nothing is recomputed, so these steps
match the session by construction.

`update_filter` is the exception. MUedit2 logs the window and flags (`use_peeloff`,
`lock_spikes`) and the diff it produced, and MUreplay recomputes the step on the BIDS EMG, so a
reviewer sees the filter actually rerun. That needs the raw recording, SciPy and the refit
code, so it runs on the server (`/edit/update-filter`). If the refit fails (the EMG has moved,
say), the page falls back to the step's logged diff and says so in the status.

Decisions worth knowing before changing this area:

- **The refit is a mirror, not a port.** `replay/filter_update.py` is MUedit2's refit, kept
  identical down to the order of float operations, so a replayed step lands on the saved
  result exactly. `tests/test_muedit2_parity.py` runs both side by side and replays MUedit2's
  sample session end to end. Change it only by porting MUedit2's code
  ([recipes.md](recipes.md#follow-a-muedit2-change)).
- **The refit filters as the session did.** MUedit2 notches and bandpasses a grid once, whole
  (the FFT notch can't run on a window), and refits windows of that. `filter_service.py` does
  the same on every call, with the grid's bandpass (surface or intramuscular) chosen from its
  name as MUedit2's grid catalogue would.
- **Peel-off follows the session.** MUedit2 subtracts the other *live* MUs of the grid: flagged
  and removed ones are left out. The page works out which MUs were flagged or removed at the
  step being replayed (`replay/operations.js: inactiveMusBefore`) and sends them as
  `inactive_mus`.
- **The replay starts where the edits did.** When no `_decomp.npz` is beside the log, the
  page opens the `_edited.npz` and undoes the logged diffs, last first, to find step 0
  (`replay-service.js: replayBase`); `beginSession` decides which from the file's name.
- **Undo restores, it doesn't recompute.** Every step applied forward pushes a backup of the
  MU's rows; stepping back pops it. A refit is therefore never rerun to go backwards.
- **One seek at a time.** A refit takes over a second while the play timer and a slider drag
  fire faster, so a seek requested mid-flight parks its target and the running one picks up
  the newest when it finishes (`seekReplayPosition`).

## The timeline

The timeline shows the steps that touch the current MU. A run of consecutive spike edits on one
MU is merged into one timeline step (`rebuildReplayGroups`); every other step is its own.
Steps of MUs that the log removed and the file no longer holds are left out.

MUedit2 names MUs in the log by uid (`g<grid>_mu<n>`). When the edit log's uid list no longer
matches the decomposition (MUs were removed before saving), the page numbers the
decomposition's MUs as MUedit2 did when the session opened (`api/payloads.js: buildMuUids`).

## Backend layers

```text
api/routes  ──>  api/services  ──>  io  ──>  replay
                                     (all over errors, paths)
```

Each layer imports only the layers to its right. `api/` holds everything HTTP: request models
(`schemas.py`), the envelope (`common.py`), error handlers (`errors.py`), the services. The
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
  as `JsonObject` and is normalised at the boundary (`api/payloads.js`).
