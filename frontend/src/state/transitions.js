/**
 * State changes that span several slices, such as opening a new session.
 */

/** @typedef {import("./state.js").State} State */
/** @typedef {ReturnType<typeof import("../api/payloads.js").normalizeSessionPayload>} SessionPayload */

/**
 * A loaded session replaces the one shown: its file, its decomposition and its
 * log. The caller then starts the replay, which rebuilds the timeline and the
 * marks from the log.
 *
 * `sourceFilename` is the decomposition's: an `_edited.npz` stands in when no
 * `_decomp.npz` was found.
 *
 * @param {State} state
 * @param {SessionPayload} payload
 */
export function beginSession(state, payload) {
  // An edited file already holds the edits; the replay rewinds them to find its start.
  state.loadedFromDecomp = /_decomp\.npz$/i.test(payload.sourceFilename);
  state.bidsRoot = payload.bidsRoot;
  state.entityLabel = payload.entityLabel;
  state.fsamp = payload.fsamp;
  state.pulseTrains = payload.pulseTrains;
  state.spikeTimes = payload.spikeTimes;
  state.gridNames = payload.gridNames;
  state.muGridIndex = payload.muGridIndex;
  state.muUids = payload.muUids;
  state.artifactTimes = payload.artifactTimes;
  state.artifactRegions = payload.artifactRegions;
  state.refitSettings = payload.refitSettings;
  state.editHistory = payload.editHistory;
}
