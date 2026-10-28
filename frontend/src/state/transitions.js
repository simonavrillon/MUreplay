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
 * @param {{ filename: string, bidsRoot: string, entityLabel: string }} file
 *   `filename` is the decomposition's: an `_edited.npz` stands in when no `_decomp.npz` was found.
 * @param {EditedPayload} payload
 */
export function beginSession(state, file, payload) {
  // An edited file already holds the edits; the replay rewinds them to find its start.
  state.loadedFromDecomp = /_decomp\.npz$/i.test(file.filename);
  state.bidsRoot = file.bidsRoot;
  state.entityLabel = file.entityLabel;
  state.fsamp = payload.fsamp;
  state.pulseTrains = payload.pulseTrains;
  state.spikeTimes = payload.spikeTimes;
  state.gridNames = payload.gridNames;
  state.muGridIndex = payload.muGridIndex;
  state.muUids = payload.muUids;
  state.artifactTimes = payload.artifactTimes;
  state.artifactRegions = payload.artifactRegions;
  state.refitSettings = payload.refitSettings;
  state.history = [];
  state.replayGroups = [];
  state.filteredReplayGroups = [];
  state.muMarks = {};
  state.muGhostUids = [];
}
