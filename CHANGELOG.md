# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- A **Projects** tree at the top of the settings rail lists the BIDS projects in the data folder,
  down to their participants, sessions and trials; clicking a trial opens it. It replaces the
  **Load log file** button, whose file dialog moves under the tree as **Open another file…**.
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

- The page looks like MUedit2's: its font, header, buttons and status, at the top right. The
  two plots are drawn as on MUedit2's edit page, and the pulse train's plot is named
  **Pulse train**.
- The timeline slider is now a step line: one dot per step, coloured by what it did and drawn
  as in MUedit2's live run, filled up to the current step. Beside it, a GitHub-style summary counts the discharges the
  replayed steps added and removed on the unit: `Step 4 / 7 +22 −23`.

- Status messages are plain sentences: a failed load reads "Could not load the session: …", and
  a filter step that could not be recomputed says it was replayed from the edit log instead.
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
- The file dialog asks for a decomposition (`.npz`) or its edit log (`.json`).
- Filter steps are recomputed with the settings the decomposition was run with (channel
  extension, peel-off window and precision), as MUedit2's editor does, rather than with its
  defaults.
- The EMG is read up to the recording duration its BIDS sidecar declares, not into the padding
  of the file's last data record.
- A filter step reads its grid from the BIDS recording as MUedit2 does: channels are matched to
  the EDF/BDF signals by name, grids need not be named `Grid<n>`, and an `_emg.json` higher in
  the dataset applies too.
- Sessions open faster: only the parts of the decomposition the replay shows are read.
- The API names discharge times `spike_times` (one MU's: `spikes`), as MUedit2 does; the load
  response drops `source_kind`, `paired_files`, `artifact_samples`, `total_samples` and
  `bids_entity_label`, and its `entity_label` is now the decomposition's; the refit response
  drops `fsamp`.
- The refit request names its MU `mu`, as MUedit2 does, and takes the grid from
  `mu_grid_index`; it drops `mu_idx` and `grid_index`. The load response falls back to
  `MUREPLAY_DATA_ROOT` for `bids_root` itself, so `GET /config` is gone, and the file dialog
  answers with `path` alone.

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

- A file dialog left open for two minutes reports "File dialog timed out" rather than "The
  server took too long to answer."
- The current step's window is no longer shaded twice as dark while the plots are zoomed out.
- The motor unit dropdown shows the flagged, duplicated and removed marks as soon as a session
  opens, and never opens on a removed unit.
- Opening a second session no longer keeps the first one's motor unit marks.
- A session whose folder has no `_decomp.npz` replays from where its edits started, not from
  their result.
