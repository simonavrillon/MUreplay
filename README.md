# MUreplay

Lightweight replay app for MUedit editing sessions. Useful for inspecting the editing work of students or colleagues in collaborative projects, or for reviewing decomposition edits from other groups when assessing a paper.

## Status

We continue to actively maintain and update these tools in line with the advancements of our research projects, and we welcome any contributions to make them useful for the wider community.

## Features

- Replays MUedit2 edit steps on an interactive timeline
- Loads decomposition data from `.npz` with pulse trains and discharge times
- Loads edit logs from MUedit2 `_edited.json`
- `Prev`/`Next` navigation with MUedit2-style undo-like state management
- `update_filter` steps replayed with the real filter-update algorithm against BIDS EMG
- Displays firing rate (instantaneous discharge rate) and pulse train with discharge markers

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

2. Launch the app from the repository root:

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

## Configuration

| Variable | Default | Description |
|---|---|---|
| `MUREPLAY_HOST` | `0.0.0.0` | API bind host |
| `MUREPLAY_BACKEND_PORT` | `8000` | API port |
| `MUREPLAY_FRONTEND_PORT` | `8080` | Frontend port |
| `MUREPLAY_OPEN_BROWSER` | `1` | Set to `0` to skip auto-opening browser |

`frontend/runtime-config.js` is generated at launch from
`frontend/runtime-config.template.js`.

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
- `history`: array of edit actions
- `mu_uids`: optional MU id list overriding NPZ ids

```json
{
  "history": [
    {
      "type": "update_filter",
      "mu_uid": "g0_mu0",
      "timestamp": "2026-04-16T14:32:10.000Z",
      "view_start": 0,
      "view_end": 40000,
      "spikes_added": [3000],
      "spikes_removed": [3200]
    }
  ]
}
```

## Pairing and autoload naming

- Preferred replay pair:
  - `<entity>_decomp.npz`
  - `<entity>_edited.json`
- If the user selects `<entity>_edited.npz`, MUreplay auto-tries to load:
  - `<entity>_decomp.npz`
  - `<entity>_edited.json`

under `MUREPLAY_BIDS_ROOT` (set in `frontend/runtime-config.js`).
