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

1. Click **Load** and select the `<entity>_edited.npz` or `<entity>_decomp.npz` file.
2. MUreplay infers the entity label from the filename, locates the paired `_decomp.npz` and `_edited.json` in the same folder, and merges the edit history from the JSON sidecar.

---

## Step 2 — Select a motor unit

Use the **Grid** and **Motor Unit** dropdowns to focus on a specific MU. Both charts update immediately.

**Keyboard shortcuts** (click on the canvas first to activate):

| Key | Action |
|---|---|
| `<` | Previous motor unit |
| `>` | Next motor unit |

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

### What each step type does

| Step type | What MUreplay replays |
|---|---|
| `update_filter` | Reads the matching BIDS EMG file and runs the filter pipeline to recompute discharge times and the pulse train. Requires `bids_root`, `entity_label`, `scipy`, and `pyedflib`. |
| `add_spikes` | Finds peaks in the pulse train above a threshold within the ROI and adds them to the discharge times. |
| `delete_spikes` | Removes discharge times that fall within a rectangular ROI. |
| `delete_dr` | Removes spikes whose discharge rate exceeds a threshold within the ROI. |
| `remove_outliers` | Removes spikes whose discharge rate exceeds mean + 3 SD across the full spike train. |
| `flag_mu` | Marks or unmarks the MU as flagged (visual indicator only, no discharge time change). |

If `update_filter` cannot reach the BIDS source, the step is skipped and discharge times remain as-is.

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
