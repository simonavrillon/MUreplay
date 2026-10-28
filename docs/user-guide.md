# MUreplay User Guide

MUreplay replays a motor unit editing session saved by MUedit2, step by step. Open the edited
decomposition, pick a motor unit, and step through every edit made to it on a timeline. This
guide covers every control, step type, colour and shortcut. Which files MUreplay reads is in
[file-formats.md](file-formats.md); problems are in [troubleshooting.md](troubleshooting.md).

```text
Open a session  →  Pick a motor unit  →  Step through its edits
```

Nothing you do in MUreplay changes a file. It rebuilds the session from the edit log, so you
can step backward and forward as often as you like.

---

## Open a session

Click **Load log file** (top right) and pick one of the files MUedit2 saved for the recording:
`<entity>_decomp.npz`, `<entity>_edited.npz` or `<entity>_edited.json`. They usually sit in
`<dataset>/derivatives/muedit/sub-XX/[ses-YY]/decomp/`.

Whichever you pick, MUreplay opens the decomposition MUedit2 started from (`_decomp.npz`) with
the edit log beside it (`_edited.json`), and finds the original EMG recording in the dataset for
the filter steps. The status line under the selectors then reports what was loaded, for example
`Loaded 36 MUs + 4 replay steps`. The full pairing rules are in
[file-formats.md](file-formats.md#how-files-are-paired).

---

## Pick a motor unit

The **Grid** and **Motor unit** dropdowns choose the unit shown; `<` and `>` step to the previous
and next unit of the grid. The two plots show the unit:

| Plot | Shows |
|---|---|
| **Firing Rate (pps)** | the instantaneous discharge rate, one dot per pair of discharges |
| **Pulse Train / Discharge Times** | the pulse train, with a dot on each discharge |

### Motor unit marks

The **Motor unit** dropdown carries the marks the edit log puts on units:

| Prefix | Meaning | Selectable |
|---|---|---|
| `✕ MU N` | flagged for removal | yes |
| `⊕ MU N` | created as a duplicate of another unit | no |
| `⊗ MU N` | removed during the session | no |

Units the session removed and the decomposition no longer holds are listed last, disabled, by
their uid: `⊗ g0_mu34 (removed)`. On opening, MUreplay selects the first unit that can be
selected, and `<` / `>` skip the ones that cannot.

---

## Step through the edits

The timeline holds the steps that touch the selected unit, in the order they were made. A run of
consecutive spike edits on the same unit is one timeline step.

| Control | Action |
|---|---|
| **Previous step** (`⏮`) | Undo one step |
| **Next step** (`⏭`) | Apply one step |
| The slider | Jump to any step |
| **Play or pause** (`▶` / `⏸`) | Apply the steps one after another |

The counter beside them reads `Step 3 / 12`, and the status line says what the last step did,
for example `Applied replay step 3/12: update_filter`. The plots mark the current step's window
and, on the pulse train, its added (green) and removed (red) discharges.

### Timeline colours

The slider's track is coloured by what each step did to the selected unit:

| Colour | Step type |
|---|---|
| Green | added discharges (`add_spikes`) |
| Red | removed discharges (`delete_spikes`, `delete_dr`, `remove_outliers`) |
| Green and red | a merged step that did both |
| Blue | filter recomputation (`update_filter`) |
| Orange | artifact markers (`add_artifact`, `delete_artifact`) |
| Grey | a step that changes no discharge, such as `flag_mu` |

### What each step type does

| Step type | What MUreplay replays |
|---|---|
| `add_spikes` | Adds the discharges the edit added. |
| `delete_spikes` | Removes the discharges the edit removed. When the box also covered artifact markers, MUedit2 logged a separate `delete_artifact` step. |
| `delete_dr` | Removes the discharges the edit removed. |
| `remove_outliers` | Removes the discharges the edit removed. |
| `update_filter` | Recomputes the unit's filter over the logged window on the original EMG, as MUedit2 did, and redetects its discharges there; the pulse train is updated too. **Peel-off** (`use_peeloff`) first subtracts the other units of the grid that were live at that point, and **Lock spikes** (`lock_spikes`) keeps the existing discharges, moved to their nearest peak. The unit's artifact markers are always subtracted. If the EMG cannot be read, the step's logged result is applied instead and the status line says `update_filter step fallback`. |
| `add_artifact` | Marks the peaks as artifacts, shown as orange dots on the pulse train. They change no discharge, but every later `update_filter` on the unit subtracts them. |
| `delete_artifact` | Removes those artifact markers. |
| `flag_mu` | Flags the unit for removal (`✕` in the dropdown). |
| `duplicate_mu` | Records that a unit was duplicated (`⊕` in the dropdown). |
| `remove_duplicates`, `remove_flagged` | Record the units removed when the session was saved (`⊗` in the dropdown); their steps leave every timeline. |

Every step but `update_filter` is replayed from what the edit log recorded, so it matches the
session exactly. `update_filter` is recomputed, with MUedit2's own algorithm, so it matches too
while the original recording is available.

### Artifact windows

Time ranges excluded from the decomposition show as shaded orange bands on the pulse train.
They are read from the decomposition and do not change during the replay.

---

## Navigate the plots

The bar under the pulse train shows the whole recording, with the selected unit's discharges,
the current step's added and removed discharges, and the part in view outlined. Drag it to pan;
click it to centre the view there.

| Key | Action |
|---|---|
| `←` / `→` | Scroll the view left / right |
| `↑` / `↓` | Zoom in / out |
| `Space` | Play / pause |
| `<` / `>` | Previous / next motor unit |

Shortcuts are ignored while a dropdown has the focus: after choosing a unit, click a plot
before pressing a key.
