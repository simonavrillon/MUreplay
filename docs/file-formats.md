# MUreplay File Formats

Everything MUreplay reads from disk, and what is inside each file. This is the
page you want when you start inspecting edit histories in your own scripts.

## Supported input formats

| Format | Extension | Description |
|---|---|---|
| Decomposition | `.npz` | MUedit2-style decomposition output (pulse trains + discharge times) |
| Edit log | `_edited.json` | MUedit2 edit-history sidecar (`history`, `mu_uids`, `artifact_times`) |
| BIDS EMG | `.bdf`, `.edf` | Raw recording with a `_channels.tsv` sidecar (legacy `_emg_channels.tsv` also accepted), used to replay `update_filter` steps |

Recent MUedit2 versions save the decomposition under
`<bids_root>/derivatives/muedit/sub-XX/[ses-YY]/decomp/`, while the raw EMG
stays at `<bids_root>/sub-XX/[ses-YY]/emg/`. MUreplay reads both layouts (the
older flat `<bids_root>/sub-XX/decomp/` is still supported) and infers the
BIDS dataset root automatically.

## Decomposition format (`.npz`)

MUreplay reads both NPZ layouts MUedit2 writes: schema v1 (older MUedit2,
object arrays) and schema v2 (current MUedit2, marked by a
`schema_version: 2` member, pickle-free). Both normalise to the same
replay payload.

Discharge times come from either layout:

- v1: `discharge_times` (or `distimes`, `dischargeTimes`)
- v2: the CSR pair `spike_times` + `spike_offsets`

Other keys read:

- `pulse_trains` (or `pulseTrains`) — optional; when absent, binary pulse
  trains are drawn from the discharge times, exactly as MUedit2's own loader
  does for spikes-only files
- `fsamp` (or `fs`)
- `total_samples` (v2)
- `grid_names` — a plain list in v1, JSON-encoded in one string in v2
- `mu_grid_index`
- `mu_uids`
- `edit_history` (or `history`) if present in NPZ
- Artifact regions: `artifact_mask` (per-sample boolean) in v1, or
  `artifact_intervals` (JSON-encoded `[[start, end], ...]` sample pairs) in v2

If `mu_uids` is missing, MUreplay generates ids from `mu_grid_index`.

## Edit log format (`_edited.json`)

MUreplay reads edit steps from a JSON sidecar with:

- `history`: array of edit actions (`update_filter`, `add_spikes`,
  `delete_spikes`, `delete_dr`, `remove_outliers`, `add_artifact`,
  `delete_artifact`, `flag_mu`, `duplicate_mu`, `remove_duplicates`,
  `remove_flagged`)
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

These files are resolved from the folder of the selected file (e.g.
`derivatives/muedit/sub-XX/[ses-YY]/decomp/`), and the backend data root
(override with the `MUREPLAY_DATA_ROOT` environment variable) is used as a
fallback BIDS root.
