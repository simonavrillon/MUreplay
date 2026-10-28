/**
 * State changes that span several slices, such as opening a new session.
 */

/** @typedef {import("./state.js").State} State */
/** @typedef {ReturnType<typeof import("../api/payloads.js").normalizeEditedPayload>} EditedPayload */

/**
 * A loaded session replaces the one shown: its file, its decomposition, and
 * nothing of the previous session's log, timeline or marks. The caller then
 * sets the log and starts the replay.
 *
 * @param {State} state
 * @param {{ filename: string, bidsRoot: string, entityLabel: string, bidsEntityLabel: string }} file
 * @param {EditedPayload} payload
 */
export function beginSession(state, file, payload) {
  state.editedFilename = file.filename;
  state.logFilename = file.filename;
  state.loadedFromDecomp = true;
  state.bidsRoot = file.bidsRoot;
  state.entityLabel = file.entityLabel;
  state.bidsEntityLabel = file.bidsEntityLabel;
  state.fsamp = payload.fsamp;
  state.pulseTrains = payload.pulseTrains;
  state.distimes = payload.distimes;
  state.gridNames = payload.gridNames;
  state.muGridIndex = payload.muGridIndex;
  state.muUids = payload.muUids;
  state.artifactTimes = payload.artifactTimes;
  state.artifactRegions = payload.artifactRegions;
  state.editHistory = [];
  state.history = [];
  state.replayGroups = [];
  state.filteredReplayGroups = [];
  state.muMarks = {};
  state.muGhostUids = [];
}
