# MUreplay User Guide

MUreplay lets you replay and inspect MUedit2 editing sessions step by step. Load a decomposition file and its edit history, then navigate the full sequence of edits on an interactive timeline.

---

## Workflow overview

```
Load data  →  Select motor unit  →  Navigate timeline
```

---

## Step 1 — Load data

### Supported loading paths

| Path | When to use |
|---|---|
| Direct NPZ upload | You have a single `.npz` file, optionally with embedded edit history |
| Paired autoload | You have a `<entity>_decomp.npz` + `<entity>_edited.json` pair (e.g. from a MUedit2 BIDS output folder) |

### Path A — Direct NPZ upload

1. Click the **Load** button (top-right of the workspace).
2. Select any MUedit2-style `.npz` file.
3. MUreplay reads pulse trains, discharge times, grid metadata, and any edit history embedded in the file.

### Path B — Paired autoload

1. Click **Load** and select the `<entity>_edited.npz` or `<entity>_decomp.npz` file. In recent MUedit2 versions these live under `<bids_root>/derivatives/muedit/sub-XX/[ses-YY]/decomp/` (the raw EMG stays at `<bids_root>/sub-XX/[ses-YY]/emg/`); older flat layouts (`<bids_root>/sub-XX/decomp/`) are still supported.
2. MUreplay infers the entity label from the filename, locates the paired `_decomp.npz` and `_edited.json` in the same folder, and merges the edit history from the JSON sidecar. The BIDS dataset root is inferred automatically (stepping above any `derivatives/muedit` segment) so `update_filter` replay can find the raw EMG. Files saved from MUreplay are written back to the same `derivatives/muedit/.../decomp/` location.

---

## Step 2 — Select a motor unit

Use the **Grid** and **Motor Unit** dropdowns to focus on a specific MU. Both charts update immediately.

### Motor unit status indicators

When the loaded edit history contains `flag_mu`, `duplicate_mu`, or `remove_duplicates` entries, the Motor Unit dropdown annotates affected MUs with a prefix symbol:

| Prefix | Meaning | Selectable |
|---|---|---|
| `✕ MU N` | Flagged for deletion | Yes — pulse train still visible for inspection |
| `⊕ MU N` | Created as a duplicate of another MU | No — greyed out |
| `⊗ MU N` | Removed by deduplication | No — greyed out |

MUs that were removed and are no longer present in the final file appear at the bottom of the list as disabled entries in the form `⊕ g0_mu34 (removed)`.

On load, if the first MU in the grid would be greyed out, MUreplay automatically selects the first non-disabled MU. The `<` / `>` keyboard shortcuts also skip disabled MUs.

**Keyboard shortcuts** (click on the canvas first to activate):

| Key | Action |
|---|---|
| `<` | Previous motor unit (skips disabled MUs) |
| `>` | Next motor unit (skips disabled MUs) |

---

## Step 3 — Navigate the timeline

The timeline displays only the edit steps that affect the currently selected motor unit.

### Controls

| Control | Action |
|---|---|
| **⏮ Prev** | Step one edit backward |
| **⏭ Next** | Step one edit forward |
| **Slider** | Jump to any step directly |
| **▶ Play / ⏸ Pause** | Auto-advance through steps |

The **step counter** (e.g. `Step 3 / 12`) and the status bar show the current action type, MU uid, and parameters (time range, spikes added or removed).

### Timeline colours

| Colour | Step type |
|---|---|
| Green | `add_spikes` |
| Red | `delete_spikes`, `delete_dr`, `remove_outliers` |
| Blue | `update_filter` |
| Orange | `add_artifact`, `delete_artifact` |

### What each step type does

| Step type | What MUreplay replays |
|---|---|
| `update_filter` | Reads the matching BIDS EMG file and runs the filter pipeline to recompute discharge times and the pulse train. The `use_peeloff` flag recorded in the history entry is honoured: when true, the waveform contributions of all other MUs on the same grid are subtracted from the whitened signal before the filter is recomputed. The `lock_spikes` flag is also honoured: when true, the original spikes in the window are realigned to their nearest detected peak (within ±10 samples) and merged with the newly detected spikes, so existing spikes are preserved rather than replaced. Any artifact markers present at that point in the session are also subtracted unconditionally. Requires `bids_root`, `entity_label`, `scipy`, and `pyedflib`. |
| `add_spikes` | Finds peaks in the pulse train above a threshold within the ROI and adds them to the discharge times. |
| `delete_spikes` | Removes discharge times that fall within a rectangular ROI. In MUedit2 this action also clears any artifact markers inside the same ROI; those are logged as a separate `delete_artifact` entry. |
| `delete_dr` | Removes spikes whose discharge rate exceeds a threshold within the ROI. |
| `remove_outliers` | Removes spikes whose discharge rate exceeds mean + 3 SD across the full spike train. |
| `add_artifact` | Records that a peak was marked as an artifact. The artifact is shown as an orange dot on the pulse train canvas. It does not affect discharge times; it is subtracted from the whitened signal whenever `update_filter` is run for the same MU. |
| `delete_artifact` | Removes the listed artifact markers from the per-MU artifact set (emitted by MUedit2 when a `delete_spikes` ROI also covered artifacts). Stepping backward restores them. |
| `flag_mu` | Marks or unmarks the MU as flagged (visual indicator only, no discharge time change). |
| `duplicate_mu` | Records that a new MU was created as a copy of an existing one. No discharge time change is replayed; the entry is used to annotate the dropdown. |
| `remove_duplicates` | Records that deduplication was run and lists the UIDs that were removed. Removed UIDs are annotated in the dropdown; their edit steps are excluded from all timelines. |

If `update_filter` cannot reach the BIDS source, the step is skipped and discharge times remain as-is.

### Peel-off during filter replay

When a `update_filter` history entry has `use_peeloff: true`, MUreplay subtracts the averaged MUAP waveforms of all other MUs on the same grid from the whitened signal before recomputing the filter — exactly as MUedit2 did when the edit was originally made. The peel-off flag is read from the history log and cannot be toggled during replay.

### Artifact markers

Artifact markers are loaded from the `artifact_times` key in the `_edited.json` sidecar and tracked separately from discharge times throughout the replay session. As the timeline is advanced:

- Each `add_artifact` step adds its peaks to the per-MU artifact set.
- Each `delete_artifact` step removes its peaks from the set (MUedit2 emits this when a `delete_spikes` ROI also covered artifacts).
- Stepping backward inverts each step (removing added peaks, restoring removed ones).
- The current artifact set is always passed to any `update_filter` step, so the filter replay faithfully reproduces the original result.

Both peel-off and artifact subtraction can be active at the same time during a `update_filter` replay step: peel-off runs first (if the flag is set), then any artifact peaks are subtracted unconditionally.

Artifacts are displayed as filled orange dots on the pulse train chart at their actual position on the signal.

### Chart navigation (keyboard shortcuts)

| Key | Action |
|---|---|
| `←` / `→` | Scroll the view left / right |
| `↑` / `↓` | Zoom in / out |
| `Space` | Play / Pause |
| Double-click canvas | Zoom back out to full signal |

---

## Troubleshooting

| Symptom | Fix |
|---|---|
| File won't load | Check the extension is `.npz`; for paired autoload confirm the `_edited.json` sidecar exists alongside the decomp NPZ |
| `update_filter` replay fails | Ensure the BIDS root path is set and the original EMG file is accessible |
| Port already in use | Set `MUREPLAY_BACKEND_PORT` / `MUREPLAY_FRONTEND_PORT` to free ports before launching |
| Browser does not open | Navigate manually to `http://localhost:8080` (or the port shown in the terminal) |
| Timeline shows no steps | The loaded edit log may be empty, or no edits were made for the selected MU |
