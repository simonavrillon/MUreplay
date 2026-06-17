# MUreplay

Lightweight replay app for MUedit2 motor unit editing sessions. Useful for inspecting the editing work of students or colleagues in collaborative projects, or for reviewing decomposition edits from other groups when assessing a paper.

## Status

This software is functional and ready for use. We continue to actively maintain and update these tools in line with the advancements of our research projects, and we welcome any contributions to make them useful for the wider community.

## Features

- Replays MUedit2 edit steps on an interactive timeline
- `Prev`/`Next` navigation with MUedit2-style undo-like state management
- `update_filter` steps replayed with the real filter-update algorithm against BIDS EMG, honouring the `use_peeloff` and `lock_spikes` flags recorded in the edit log
- Artifact markers (`add_artifact` / `delete_artifact`) tracked per motor unit and subtracted during filter replay
- Displays firing rate (instantaneous discharge rate) and the pulse train with discharge and artifact markers
- Web-based interface with a Python backend and JavaScript frontend
- Cross-platform launchers (macOS/Linux and Windows)

## Supported Input Formats

| Format | Extension | Description |
|---|---|---|
| Decomposition | `.npz` | MUedit2-style decomposition output (pulse trains + discharge times) |
| Edit log | `_edited.json` | MUedit2 edit-history sidecar (`history`, `mu_uids`, `artifact_times`) |
| BIDS EMG | `.bdf`, `.edf` | Raw recording with a `_channels.tsv` sidecar (legacy `_emg_channels.tsv` also accepted), used to replay `update_filter` steps |

Recent MUedit2 versions save the decomposition under `<bids_root>/derivatives/muedit/sub-XX/[ses-YY]/decomp/`, while the raw EMG stays at `<bids_root>/sub-XX/[ses-YY]/emg/`. MUreplay reads both layouts (the older flat `<bids_root>/sub-XX/decomp/` is still supported) and infers the BIDS dataset root automatically.

## Requirements

- Python 3.11+
- Conda (Anaconda or Miniconda)
- `numpy` for `.npz` loading
- `scipy` and `pyedflib` for `update_filter` replay against BIDS EMG

## Quick Start

1. Create and activate the conda environment:
```bash
conda env create -f environment.yml
conda activate MUreplay
```

2. Install MUreplay in editable mode:
```bash
pip install -e .
```

3. Launch the app from the repository root:

macOS / Linux:
```bash
./scripts/run_MUreplay.sh
```

Windows (PowerShell):
```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\run_MUreplay.ps1
```

Or run manually (split terminals):
```bash
cd python && python server.py --host 0.0.0.0 --port 8000
```
```bash
cd frontend && python -m http.server 8080
```

Then open `http://localhost:8080`.

Windows first-time setup (if script execution is blocked):
```powershell
Set-ExecutionPolicy -Scope CurrentUser RemoteSigned
```

## CLI Entrypoints

After installation, MUreplay exposes:

- `mureplay-server` — starts the backend API server

## Verify Installation

With MUreplay running, open `http://localhost:8080` in a browser.

## Troubleshooting

- `python: command not found` — activate the conda env before launching.
- Port already in use — set `MUREPLAY_BACKEND_PORT` / `MUREPLAY_FRONTEND_PORT` to free ports.
- Browser does not open automatically — open `http://localhost:<MUREPLAY_FRONTEND_PORT>` manually.
- `update_filter` replay fails — check that `scipy` and `pyedflib` are installed and the BIDS root path is set correctly.

## Documentation

- User guide: [docs/user-guide.md](docs/user-guide.md)

## Decomposition format (`.npz`)

MUreplay expects MUedit2-style NPZ content. These keys are read:

- Required:
  - `pulse_trains` (or `pulseTrains`)
  - `discharge_times` (or `distimes`, `dischargeTimes`)
- Optional:
  - `fsamp` (or `fs`)
  - `grid_names`
  - `mu_grid_index`
  - `mu_uids`
  - `edit_history` (or `history`) if present in NPZ

If `mu_uids` is missing, MUreplay generates ids from `mu_grid_index`.

## Edit log format (`_edited.json`)

MUreplay reads edit steps from a JSON sidecar with:
- `history`: array of edit actions (`update_filter`, `add_spikes`, `delete_spikes`, `delete_dr`, `remove_outliers`, `add_artifact`, `delete_artifact`, `flag_mu`, `duplicate_mu`, `remove_duplicates`)
- `mu_uids`: optional MU id list overriding NPZ ids
- `artifact_times`: optional per-MU artifact sample positions

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
  "mu_uids": ["g0_mu0"],
  "artifact_times": [[12000, 18500]]
}
```

## Pairing and autoload naming

- Preferred replay pair:
  - `<entity>_decomp.npz`
  - `<entity>_edited.json`
- If the user selects `<entity>_edited.npz`, MUreplay auto-tries to load:
  - `<entity>_decomp.npz`
  - `<entity>_edited.json`

These files are resolved from the folder of the selected file (e.g. `derivatives/muedit/sub-XX/[ses-YY]/decomp/`), and `MUREPLAY_BIDS_ROOT` (set in `frontend/runtime-config.js`) is used as a fallback BIDS root.

## Acknowledgment

MUreplay is a companion to MUedit for high-density EMG decomposition; it replays the editing sessions produced by MUedit2.
