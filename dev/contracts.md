# Contracts

The rules both sides of a boundary depend on: what the frontend and backend must agree on, and
what MUreplay takes from MUedit2. Field-level details live in the code named in each section;
change these only together with the other side, and with a test.

## HTTP

- Every route sits under `/api/v1` and is registered in `api/routes/__init__.py`. The frontend
  names each path once, in `frontend/src/api/routes.js`, and calls it through
  `frontend/src/api/client.js`. `tests/test_api_app.py` fails when `routes.js` names a path the
  backend doesn't serve.
- Request bodies are Pydantic models in `api/schemas.py`. A missing or mistyped field is a 422.
- Success: `{"data": <data>, "meta": {"api_version": "v1"}}` (`common.success_payload`), or a
  MUB1 frame for the routes that send arrays ([below](#mub1-frames)).
- Error: `{"error": {"code", "message", "detail"}}` (`api/errors.py`).

| Route | Does |
|---|---|
| `GET /projects` | the BIDS datasets in the data folder (`paths.data_root`) (or that folder, when it is one), each a tree of subjects, sessions (`""` when the subject has none) and trials; a trial is an `_edited.json` under the dataset, named by its entities below the session, with its `path` for `/replay/session/open`. `data_root` is the folder listed |
| `POST /dialog/data-folder` | opens the native folder dialog and saves the pick as the data folder in the per-user config; `data_root` is the folder, or `null` when cancelled. A 400 while `MUREPLAY_DATA_ROOT` is set, since it would override the pick |
| `POST /replay/session/open` | opens the decomposition and edit log paired with a path ([file-formats.md](../docs/file-formats.md#how-files-are-paired)) in a replay session, rewound to step 0 when only the `_edited.npz` is there; a state frame. Its `meta` is complete: `fsamp`, `total_samples`, `grid_names`, one `mu_grid_index` and `mu_uids` entry per MU (numbered as MUedit2 does when the log's uids no longer match), `versions`, `edit_history` (the log's object entries), `artifact_regions`, `parameters` (the run settings the settings rail shows, those the file has as plain values), `sidecar_meta` (the participant, placement and hardware fields of the BIDS sidecars, `io/bids.py:read_sidecar_meta`, MUedit2's; empty when they cannot be read), `bids_root`, `entity_label`, `source_filename`, `token`. A refit repeats the run's `nbextchan`, `peel_off_win` and `compute_dtype`, MUedit2's defaults where the file's `parameters` have none (`io/loaders.py: _refit_settings`) |
| `POST /replay/seek` | `{token, steps}`: undoes and applies steps until the session holds exactly `steps` (edit-log indices, in order); a change frame |
| `POST /replay/session/prepare-grid` | `{token, grid}`: filters the grid's EMG now, so its first refit doesn't wait; 204 once done |
| `GET /series/pulse` | `token`, `mu`, `start`, `end` (0 = the end), `bins`: one MU's pulse train over the window, with its discharges and artifact markers there; a pulse frame |
| `POST /session/close?session=` | drops what the tab holds; 204. A `keepalive` fetch on `pagehide` |

### Errors

| Raised | Status | `code` | Client sees |
|---|---|---|---|
| `MureplayError` (`mureplay/errors.py`) | 400 | `http_400` | `message` as-is; `detail.field` names the request field at fault |
| `NotFoundError` | 404 | `http_404` | same |
| `RequestValidationError` | 422 | `validation_error` | `message` "Request validation failed", the Pydantic errors in `detail`; the page shows the message alone |
| `HTTPException` (routing, the dialog) | its status | `http_<status>` | its `detail` as the message |
| anything else | 500 | `internal_error` | a generic message; the traceback goes to the server's terminal only |

The page raises these as `ApiError` (`api/http.js`), with `status` and `field`. Branch
on those, never on the message text.

### Tokens and expiry

| Token | Minted by | Expires when | Client recovery |
|---|---|---|---|
| replay `token` | `/replay/session/open` | another trial opened in the tab, the tab closed, an idle tab swept (20 minutes, never the active one), server restart | none: the status says "This replay is no longer open; open the trial again." |

A token the server no longer holds is a 400 with `field: "token"`. The client keys on
`ApiError.field`, never on the message text.

### Session header

`api/http.js` creates one id per page load and sends it as `X-MUreplay-Session` (1–64 letters,
digits or `-`; anything else is a 400 naming the header). Requests without it use the `default`
session. `/session/close` is a `keepalive` fetch, not a beacon, because a beacon cannot carry
the header.

## MUB1 frames

MUedit2's binary format, server to client only (`api/binary.py: pack_frame`;
`frontend/src/api/binary-payloads.js: decodeFrame`). Little-endian:

```text
"MUB1" | header_len: uint32 | header: UTF-8 JSON | pad to 8 |
array data, each array at an 8-byte-aligned offset from the data start

header = {"meta": {...}, "arrays": [{"name", "dtype", "shape", "offset"}, ...]}
dtype ∈ f4, i4, i8
```

The alignment lets the page read every array as a zero-copy typed-array view. Discharge times
of several MUs travel as a CSR pair (`spikes` `i4` + `spike_offsets` `i8`). Media type
`application/x-mureplay-frame`, header `x-mureplay-format: mub1`.

Test helpers mirror both ends: `tests/_frames.py` decodes like the page; `frontend/tests/_frames.js`
encodes like `pack_frame`. Change all four together.

| Frame | Routes | `meta` | Arrays |
|---|---|---|---|
| state | `/replay/session/open` | the session's fields (above) | CSR discharges of every MU |
| change | `/replay/seek` | `changed`, `versions`, `refit_errors` (`[{step, message}]`: refits replayed from the log instead) | CSR discharges of the `changed` MUs, in that order |
| pulse | `/series/pulse` | `mu`, `version`, `start`, `end`, `bins`, `factor`, `total_samples`, `kind` | `min`/`max` `f4[1, bins]`, or `samples` `f4[1, n]` when `kind == "samples"`; `spikes`, `spike_values`, `artifacts`, `artifact_values` in the window |

`versions[mu]` changes with every step that moves that MU; the page caches its pulse window by
it and fetches again when it changes. An MU the file has no pulse train for has one drawn from
its discharges by the server, as MUedit2 does.

## The edit log (MUedit2's format)

MUreplay reads MUedit2's `_edited.json` and never writes one. Its format is MUedit2's, documented
for users in [file-formats.md](../docs/file-formats.md#the-edit-log-_editedjson). What the replay
relies on:

- Every MU step names its MU by `mu_uid`.
- Spike edits carry `spikes_added` / `spikes_removed`, artifact edits `artifacts_added` /
  `artifacts_removed`; applying them forward and backward is exact.
- `update_filter` carries `view_start`, `view_end`, `use_peeloff`, `lock_spikes`, and its diff,
  which the session applies when the refit fails.
- `flag_mu` (with `flagged`), `remove_flagged` and `remove_duplicates` (with `removed_mu_uids`)
  change which MUs are live, for the timeline and for peel-off. Any other edit to a flagged MU
  clears its flag, as in MUedit2's session.
- Uids are `g<grid>_mu<n>`, numbered per grid from 0 in file order (`replay/session.py:
  initial_mu_uids` mirrors MUedit2's).

A new step type in MUedit2 is a change here too: see
[recipes.md](recipes.md#replay-a-new-step-type).

## Parity with MUedit2

`replay/filter_update.py` and the session filtering in `replay/session.py` must give exactly
what MUedit2's code gives on the same input. `tests/test_muedit2_parity.py` holds that, with
exact equality:

| MUreplay | MUedit2 |
|---|---|
| `filter_update.emg_filter_inplace` | `muedit.signal.filters.emg_filter_inplace` |
| `filter_update.subtract_mu_waveforms` | `muedit.decomp.algorithm.subtract_mu_waveforms` |
| `filter_update.update_motor_unit_filter_window` | `muedit.editing.operations.update_motor_unit_filter_window` |
| `artifact_mask.build_manual_artifact_mask` | `muedit.decomp.preprocess.build_manual_artifact_mask` |
| `session._INTRAMUSCULAR_GRIDS` | the `emg_type == 2` entries of `muedit.signal.grid._GRID_CATALOG` |
| `session.initial_mu_uids` | `muedit.editing.session.initial_mu_uids` |
| `io.loaders._load_npz_payload` | reads what `muedit.decomp.decomposition_file.save_decomposition_npz` writes |
| `ReplaySession.seek`, over every step of a session | the saved `_edited.npz` of that session |

CI checks MUedit2's default branch out beside MUreplay, so a change there that MUreplay hasn't
followed fails MUreplay's build.
