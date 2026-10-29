# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [1.1.0] - 2026-10-29

### Added

- A **Projects** tree at the top of the settings rail lists the BIDS projects in the data folder,
  down to their participants, sessions and trials; clicking a trial opens it. It replaces the
  **Load log file** button.
- **Change data folder** under the **Projects** tree points it at another folder of BIDS
  projects, and MUreplay remembers it for the next launch.
- `B` and `N` step back and forward through the replay.
- A settings rail on the left, as in MUedit2, shows the session's fields read-only: the BIDS
  entities, participant, placement and hardware from the dataset's sidecars, and the run's
  decomposition settings and quality filters.
- **Audit** and **Monitor** buttons at the top centre switch pages. Audit is the replay;
  Monitor is a placeholder for an upcoming page of clinical metrics.
- Decompositions saved in MUedit2's schema v2 `.npz` format open, as older v1 files still do.
- Filter steps on intramuscular grids are recomputed with the intramuscular bandpass
  (100–4400 Hz), as MUedit2 does.

### Changed

- The replay runs on the server, as MUedit2's editing does, and the page draws only the window
  of the pulse train it shows. The pulse trains are memory-mapped from the decomposition file
  rather than loaded, so long recordings open quickly and use little memory, and each grid's
  EMG is filtered once per trial instead of at every filter step. Working files go to the
  per-user cache folder (`MUREPLAY_CACHE_DIR`), with `MUREPLAY_CACHE_BUDGET_MB` and
  `MUREPLAY_DISK_RESERVE_MB` to bound memory and disk.
- The page looks like MUedit2's: its font, header, buttons and status, at the top right. The
  two plots are drawn as on MUedit2's edit page, and the pulse train's plot is named
  **Pulse train**.
- The timeline slider is now a step line: one dot per step, coloured by what it did and drawn
  as in MUedit2's live run, filled up to the current step. Beside it, a GitHub-style summary counts the discharges the
  replayed steps added and removed on the unit: `Step 4 / 7 +22 −23`.
- Status messages are plain sentences: a failed load reads "Could not load the session: …", and
  a filter step that could not be recomputed says it was replayed from the edit log instead.
- The hint shown when the EMG recording cannot be read says to choose the dataset as the data
  folder, not to set `MUREPLAY_DATA_ROOT`.
- Errors on the status show in red.
- The bar under the pulse train also marks the artifact markers the current step added or
  removed, as MUedit2's does.
- The app and its API run as one server, at <http://127.0.0.1:8000>; the launchers start it with
  `uv run mureplay api`, which also opens the browser.
- MUreplay answers only this machine's browser by default; set `MUREPLAY_HOST=0.0.0.0` to open it
  from other machines.
- Filter steps are recomputed with MUedit2's current algorithm, so they land on the discharges
  current MUedit2 sessions saved.
- Peel-off in a recomputed filter step leaves out the motor units that were flagged or removed
  at that point of the session, as MUedit2 does.
- Filter steps are recomputed with the settings the decomposition was run with (channel
  extension, peel-off window and precision), as MUedit2's editor does, rather than with its
  defaults.
- The EMG is read up to the recording duration its BIDS sidecar declares, not into the padding
  of the file's last data record.
- A filter step reads its grid from the BIDS recording as MUedit2 does: channels are matched to
  the EDF/BDF signals by name, grids need not be named `Grid<n>`, and an `_emg.json` higher in
  the dataset applies too.
- Sessions open faster: only the parts of the decomposition the replay shows are read.
- Arrays cross the API as MUB1 binary frames, never as JSON lists: an opened session answers
  with its fields and every MU's discharge times as a CSR pair (`spikes` with
  `spike_offsets`). The open response drops `source_kind`, `paired_files`, `artifact_samples`
  and `bids_entity_label`, and its `entity_label` is the decomposition's.
- The open response falls back to the data folder for `bids_root` itself, so `GET /config` is
  gone, and the folder dialog answers with `data_root` alone.

### Removed

- The page no longer waits for the backend at start, and the header has no status line: the
  server that serves the page also answers it, so it is ready as soon as the page shows.
- The `mureplay-api` command: use `mureplay api`.
- The `MUREPLAY_BACKEND_PORT` and `MUREPLAY_FRONTEND_PORT` settings: the one server takes
  `MUREPLAY_PORT`.
- The conda `environment.yml`: setup runs through `uv`.
- Edit-log fields MUedit2 never writes: `mu_idx` (a step's unit comes from its `mu_uid`),
  `time`, `action`, `op`, `start`/`end`, and discharge lists written as text.

### Fixed

- A folder dialog left open for two minutes reports "Folder dialog timed out" rather than
  "The server took too long to answer."
- The current step's window is no longer shaded twice as dark while the plots are zoomed out.
- The motor unit dropdown shows the flagged, duplicated and removed marks as soon as a session
  opens, and never opens on a removed unit.
- Opening a second session no longer keeps the first one's motor unit marks.
- A session whose folder has no `_decomp.npz` replays from where its edits started, not from
  their result.

[1.1.0]: https://github.com/simonavrillon/MUreplay/releases/tag/v1.1.0
