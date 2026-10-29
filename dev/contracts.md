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
- Success: `{"data": <data>, "meta": {"api_version": "v1"}}` (`common.success_payload`).
- Error: `{"error": {"code", "message", "detail"}}` (`api/errors.py`).

| Route | Does |
|---|---|
| `GET /projects` | the BIDS datasets in `MUREPLAY_DATA_ROOT` (or that folder, when it is one), each a tree of subjects, sessions (`""` when the subject has none) and trials; a trial is an `_edited.json` under the dataset, named by its entities below the session, with its `path` for `/load-paired-from-path`. `data_root` is the folder listed |
| `GET /dialog/open-file` | the path the user picks in the native file dialog, or `null` when cancelled |
| `POST /load-paired-from-path` | the decomposition and edit log paired with a path ([file-formats.md](../docs/file-formats.md#how-files-are-paired)), complete: `fsamp`, `grid_names` and one `mu_grid_index` entry per MU are filled in when the file has none, and `refit_settings` holds the run's `nbextchan`, `peel_off_win` and `compute_dtype`, with MUedit2's defaults where the file's `parameters` have none. `parameters` holds the run settings the settings rail shows, those the file has as plain values; `sidecar_meta` the participant, placement and hardware fields of the BIDS sidecars (`io/bids.py:read_sidecar_meta`, MUedit2's), empty when they cannot be read |
| `POST /edit/update-filter` | refits one MU on the BIDS EMG, as a logged `update_filter` step did |

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

### The refit request

`/edit/update-filter` takes the replay state the step runs on, not a token: the server holds
nothing between requests. The fields MUedit2's session would read from itself come from the
page:

| Field | Comes from |
|---|---|
| `spike_times`, `mu`, `mu_grid_index` | the replay at that step; the grid is `mu_grid_index[mu]`, as in MUedit2 |
| `view_start`, `view_end`, `use_peeloff`, `lock_spikes` | the logged step |
| `inactive_mus` | the MUs flagged or removed before the step (`inactiveMusBefore`); left out of peel-off |
| `grid_name` | the decomposition's grid names; picks the bandpass |
| `artifact_times`, `artifact_regions` | the MU's artifact markers at that step; the file's artifact windows |
| `bids_root`, `entity_label` | the load response's: the dataset inferred from the file's location (else `MUREPLAY_DATA_ROOT`), and the decomposition's recording |
| `nbextchan`, `peel_off_win`, `compute_dtype` | the load response's `refit_settings`: the decomposition's saved run `parameters`, as MUedit2's session refits with them |

## The edit log (MUedit2's format)

MUreplay reads MUedit2's `_edited.json` and never writes one. Its format is MUedit2's, documented
for users in [file-formats.md](../docs/file-formats.md#the-edit-log-_editedjson). What the replay
relies on:

- Every MU step names its MU by `mu_uid`.
- Spike edits carry `spikes_added` / `spikes_removed`, artifact edits `artifacts_added` /
  `artifacts_removed`; applying them forward and backward is exact.
- `update_filter` carries `view_start`, `view_end`, `use_peeloff`, `lock_spikes`, and its diff,
  which the page applies when the refit fails.
- `flag_mu` (with `flagged`), `remove_flagged` and `remove_duplicates` (with `removed_mu_uids`)
  change which MUs are live, for the timeline and for peel-off. Any other edit to a flagged MU
  clears its flag, as in MUedit2's session.
- Uids are `g<grid>_mu<n>`, numbered per grid from 0 in file order (`buildMuUids` mirrors
  MUedit2's `initial_mu_uids`).

A new step type in MUedit2 is a change here too: see
[recipes.md](recipes.md#replay-a-new-step-type).

## Parity with MUedit2

`replay/filter_update.py` and the session filtering in `filter_service.py` must give exactly
what MUedit2's code gives on the same input. `tests/test_muedit2_parity.py` holds that, with
exact equality:

| MUreplay | MUedit2 |
|---|---|
| `filter_update.emg_filter_inplace` | `muedit.signal.filters.emg_filter_inplace` |
| `filter_update.subtract_mu_waveforms` | `muedit.decomp.algorithm.subtract_mu_waveforms` |
| `filter_update.update_motor_unit_filter_window` | `muedit.editing.operations.update_motor_unit_filter_window` |
| `artifact_mask.build_manual_artifact_mask` | `muedit.decomp.preprocess.build_manual_artifact_mask` |
| `filter_service._INTRAMUSCULAR_GRIDS` | the `emg_type == 2` entries of `muedit.signal.grid._GRID_CATALOG` |
| `io.loaders._load_npz_payload` | reads what `muedit.decomp.decomposition_file.save_decomposition_npz` writes |
| `filter_service.run_update_filter`, replayed over a whole session | the saved `_edited.npz` of that session |

CI checks MUedit2's default branch out beside MUreplay, so a change there that MUreplay hasn't
followed fails MUreplay's build.
