/**
 * State changes that span several slices, such as opening a new session.
 */

/** @typedef {import("./state.js").State} State */
/** @typedef {ReturnType<typeof import("../api/payloads.js").normalizeSessionPayload>} SessionPayload */

/**
 * An opened session replaces the one shown: its token, its decomposition and
 * its log. The caller then starts the replay, which rebuilds the timeline and
 * the marks from the log.
 *
 * @param {State} state
 * @param {SessionPayload} payload
 */
export function beginSession(state, payload) {
  state.token = payload.token;
  state.fsamp = payload.fsamp;
  state.totalSamples = payload.totalSamples;
  state.spikeTimes = payload.spikeTimes;
  state.versions = payload.versions;
  state.pulseView = null;
  state.gridNames = payload.gridNames;
  state.muGridIndex = payload.muGridIndex;
  state.muUids = payload.muUids;
  state.artifactRegions = payload.artifactRegions;
  state.editHistory = payload.editHistory;
}
