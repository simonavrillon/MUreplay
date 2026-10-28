# MUreplay File Formats

Everything MUreplay reads from disk, what is inside each file, and how it finds one from
another. This is the page you want when you start inspecting edit histories in your own
scripts. MUreplay never writes a file.

## What MUreplay reads

| File | Written by | Used for |
|---|---|---|
| `<entity>_decomp.npz` | MUedit2, when a decomposition finishes | the decomposition the replay starts from |
| `<entity>_edited.json` | MUedit2, when an edited session is saved | the edit log the replay steps through |
| `<entity>_edited.npz` | MUedit2, when an edited session is saved | only to find the two files above |
| `<entity>_emg.bdf` / `.edf`, with `_channels.tsv` and `_emg.json` | MUedit2's BIDS export | the raw EMG `update_filter` steps are recomputed on |

`<entity>` is the BIDS entity label of the recording, such as
`sub-1_ses-1_task-triangle_run-1`.

## How files are paired

Pick any of the three session files; MUreplay takes the entity from its name (the part before
`_decomp` or `_edited`) and looks in the same folder for:

1. the decomposition: `<entity>_decomp.npz`; else, for a BIDS name with `run-N`, the first
   `*_run-N_*_decomp.npz`; else `<entity>_edited.npz`;
2. the edit log: `<entity>_edited.json`, which must be there.

Without `<entity>_decomp.npz`, MUreplay opens `<entity>_edited.npz`, which already holds the
edits, and finds the session's starting point by undoing the logged steps, last first. The
discharges and artifact markers come out exactly as they started.

> Keep `<entity>_decomp.npz` beside the edit log when you can: an edited file has only the
> final pulse trains, so a unit whose filter was recomputed shows its final pulse train until
> the replay reaches its first filter step.

## Where the EMG comes from

`update_filter` steps are recomputed on the raw recording in the BIDS dataset the session
belongs to. MUreplay takes the dataset from the opened file's location, the folder above its
`sub-*` folder, stepping over `derivatives/<pipeline>`:

```text
<dataset>/
  sub-1/ses-1/emg/sub-1_ses-1_task-triangle_run-1_emg.bdf      ← the EMG
  derivatives/muedit/sub-1/ses-1/decomp/…_decomp.npz           ← the files you open
```

The older layout with `decomp/` directly under `<dataset>/sub-XX/` works too. When the opened
file is not inside a `sub-*` folder, MUreplay reads the EMG from `MUREPLAY_DATA_ROOT` (`data/`
in the MUreplay folder by default; see [cli.md](cli.md#environment-variables)).

From the recording, MUreplay reads the grid's channels in `_channels.tsv` order (`group` =
`Grid<n>`, channels with `status` `bad` left out of the filter), and stops at the
`RecordingDuration` the `_emg.json` sidecar declares: EDF/BDF pad their last data record.

## The decomposition (`.npz`)

MUreplay reads both layouts MUedit2 writes: schema v1 (older MUedit2, object arrays) and schema
v2 (current MUedit2, marked by `schema_version: 2`, pickle-free). Both give the same replay.

| Key | v1 | v2 |
|---|---|---|
| discharge times | `discharge_times` (or `distimes`) | the CSR pair `spike_times` + `spike_offsets` |
| pulse trains | `pulse_trains` | `pulse_trains`, optional |
| sampling rate | `fsamp` | `fsamp` |
| grids | `grid_names` (a list), `mu_grid_index` | `grid_names` (JSON in one string), `mu_grid_index` |
| length | — | `total_samples` |
| artifact windows | `artifact_mask` (one boolean per sample) | `artifact_intervals` (`[[start, end], …]` in samples) |
| run settings | `parameters` (a dict) | `parameters` (JSON in one string) |

A file without pulse trains gets binary ones drawn from the discharge times, as MUedit2's own
loader does.

The run settings (`parameters`) are the settings the decomposition was run with: channel
extension (`nbextchan`), peel-off window (`peel_off_win`) and precision (`compute_dtype`). A
refit of an `update_filter` step repeats them, as MUedit2's editor does; a file without them
refits with MUedit2's defaults.

## The edit log (`_edited.json`)

MUedit2's edit log, as it saves it:

| Key | Holds |
|---|---|
| `history` | the session's steps, in order |
| `mu_uids` | the uids of the units the saved file holds |
| `artifact_times` | optional: each unit's artifact markers |

Units are named by uid, `g<grid>_mu<n>`, numbered per grid from 0. When `mu_uids` no longer
matches the decomposition (units were removed before saving), MUreplay numbers the
decomposition's units the way MUedit2 did when the session opened.

Each step has a `type`, a `timestamp` and, for a step on one unit, its `mu_uid`; the step types
are listed in the [user guide](user-guide.md#what-each-step-type-does). What else a step carries:

| Step | Fields |
|---|---|
| spike edits (`add_spikes`, `delete_spikes`, `delete_dr`, `remove_outliers`) | `spikes_added`, `spikes_removed` (sample indices) |
| `update_filter` | `view_start`, `view_end`, `use_peeloff`, `lock_spikes`, and its result as `spikes_added` / `spikes_removed` |
| `add_artifact`, `delete_artifact` | `artifacts_added`, `artifacts_removed` |
| `flag_mu` | `flagged` |
| `duplicate_mu` | `source_mu_uid` |
| `remove_duplicates`, `remove_flagged` | `removed_mu_uids` |

```json
{
  "history": [
    {
      "type": "update_filter",
      "mu_uid": "g0_mu0",
      "timestamp": "2026-04-16T14:32:10.000Z",
      "view_start": 0,
      "view_end": 40000,
      "use_peeloff": true,
      "lock_spikes": false,
      "spikes_added": [3000],
      "spikes_removed": [3200]
    }
  ],
  "mu_uids": ["g0_mu0"]
}
```
