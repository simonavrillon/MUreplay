# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- Decompositions saved in MUedit2's schema v2 `.npz` format open, as older v1 files still do.
- Filter steps on intramuscular grids are recomputed with the intramuscular bandpass
  (100–4400 Hz), as MUedit2 does.

### Changed

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

### Removed

- The `mureplay-api` command: use `mureplay api`.
- The `MUREPLAY_BACKEND_PORT` and `MUREPLAY_FRONTEND_PORT` settings: the one server takes
  `MUREPLAY_PORT`.
- The conda `environment.yml`: setup runs through `uv`.

### Fixed

- Errors on the header's status line show in red.
- The motor unit dropdown shows the flagged, duplicated and removed marks as soon as a session
  opens, and never opens on a removed unit.
- Opening a second session no longer keeps the first one's motor unit marks.
- A session whose folder has no `_decomp.npz` replays from where its edits started, not from
  their result.
