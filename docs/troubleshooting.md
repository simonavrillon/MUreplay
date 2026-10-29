# Troubleshooting

MUreplay runs entirely on your machine, so most problems are local: a port already in use, a
file that moved, or a missing edit log. This page collects the common symptoms and where to
look. The [user guide](user-guide.md) covers normal use; [file-formats.md](file-formats.md)
covers which files MUreplay reads; [cli.md](cli.md) covers the command line and environment
variables.

## Symptom / fix

| Symptom | Fix |
|---|---|
| The browser never opens | Open the address the launcher's terminal prints, <http://127.0.0.1:8000> unless you set `MUREPLAY_PORT`. |
| "address already in use" at launch | Another program holds MUreplay's port (8000), often an earlier MUreplay terminal window, or MUedit2, which uses the same port. Close it, or set `MUREPLAY_PORT` to another port before launching (see [cli.md](cli.md#environment-variables)). |
| **Projects** shows no project, or not yours | The tree lists the BIDS datasets (folders holding a `dataset_description.json`) in the data folder. Click **Change data folder** under the tree and pick the folder that holds yours. If MUreplay says the folder is set by `MUREPLAY_DATA_ROOT`, unset that variable and relaunch (see [cli.md](cli.md#environment-variables)). A recording shows up as a trial only once MUedit2 has saved its edit log (`_edited.json`). |
| "Could not load the session: No paired edited JSON found…" | The edit log is missing: the `_edited.json` MUedit2 saved must sit beside the decomposition, with the same name stem. See [how files are paired](file-formats.md#how-files-are-paired). |
| "Could not load the session: No decomp NPZ found…" | The folder holds the edit log but no decomposition. Keep the `.npz` files MUedit2 saved beside it. |
| "Replayed step … from the edit log: could not recompute the filter." while stepping | The filter could not be recomputed, usually because the original EMG recording is not where the session's dataset says. The step was replayed from the edit log instead, so the discharges are still right, but the pulse train was not recomputed. Keep the dataset's `sub-*/emg/` folder beside `derivatives/`, or choose the dataset as the data folder (see [where the EMG comes from](file-formats.md#where-the-emg-comes-from)). |
| The timeline shows no steps | The edit log may be empty, or the motor unit you selected was not edited. Pick another unit: the timeline shows only the selected unit's steps. |
| A motor unit cannot be selected | It was created as a duplicate or removed during the session (`⊕`, `⊗`); see [motor unit marks](user-guide.md#motor-unit-marks). |
| A keyboard shortcut does nothing | Shortcuts are ignored while a dropdown has the focus: click the plot, then press the key. |

## Where errors are reported

Errors from a step or a load show in red in the status at the top right; errors reaching the
server show in the launcher's terminal window. When something fails, keep that window open
and include what it shows if you [open an issue](https://github.com/simonavrillon/MUreplay/issues).
