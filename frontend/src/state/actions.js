/**
 * The only setters of `state`: every change to the app state goes through
 * a function here.
 */

/** @typedef {import("./state.js").State} State */
/** @typedef {import("./state.js").MuMark} MuMark */
/** @typedef {import("./state.js").ReplayChange} ReplayChange */
/** @typedef {import("./state.js").ReplayGroup} ReplayGroup */
/** @typedef {import("../app/context.js").Span} Span */

/**
 * @param {State} state
 * @param {number} grid
 */
export function setCurrentGrid(state, grid) {
  state.currentGrid = grid;
}

/**
 * @param {State} state
 * @param {number} mu
 */
export function setCurrentMu(state, mu) {
  state.currentMu = mu;
}

/**
 * @param {State} state
 * @param {Span | null} view
 */
export function setReplayView(state, view) {
  state.replayView = view;
}

/**
 * Playing while a timer is set; `null` stops.
 *
 * @param {State} state
 * @param {number | null} timer
 */
export function setPlayTimer(state, timer) {
  state.playTimer = timer;
}

/**
 * @param {State} state
 * @param {number} position
 */
export function setReplayPosition(state, position) {
  state.replayPosition = position;
}

/**
 * What a seek changed: the moved MUs' discharges, and every MU's version.
 *
 * @param {State} state
 * @param {ReplayChange} change
 */
export function applyReplayChange(state, change) {
  change.changed.forEach((mu, i) => {
    state.spikeTimes[mu] = change.spikeTimes[i];
  });
  state.versions = change.versions;
}

/**
 * The current MU's pulse train window, as it arrived.
 *
 * @param {State} state
 * @param {import("../api/binary-payloads.js").PulseView | null} view
 */
export function setPulseView(state, view) {
  state.pulseView = view;
}

/**
 * The replay groups, and the marks the log puts on MUs.
 *
 * @param {State} state
 * @param {ReplayGroup[]} groups
 * @param {Record<string, MuMark>} marks
 * @param {string[]} ghostUids
 */
export function setReplayGroups(state, groups, marks, ghostUids) {
  state.replayGroups = groups;
  state.muMarks = marks;
  state.muGhostUids = ghostUids;
}

/**
 * @param {State} state
 * @param {ReplayGroup[]} groups The groups that touch the current MU.
 */
export function setTimelineGroups(state, groups) {
  state.timelineGroups = groups;
}

/**
 * Back to step 0, the whole recording in view; the server is asked to follow.
 *
 * @param {State} state
 */
export function resetReplayPosition(state) {
  state.replayPosition = 0;
  state.replayView = null;
}
