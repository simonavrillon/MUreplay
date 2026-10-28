/**
 * The only setters of `state`: every change to the app state goes through
 * a function here.
 */

/** @typedef {import("./state.js").State} State */
/** @typedef {import("./state.js").EditLogEntry} EditLogEntry */
/** @typedef {import("./state.js").ReplayBackup} ReplayBackup */
/** @typedef {import("./state.js").ReplayGroup} ReplayGroup */
/** @typedef {import("../app/context.js").Span} Span */

/**
 * The decomposition a replay starts from, one row per MU.
 *
 * @typedef {object} ReplayBase
 * @property {number[][]} spikeTimes
 * @property {number[][]} pulseTrains
 * @property {number[][]} artifactTimes
 */

/** @param {number[][]} rows */
const copyRows = (rows) => rows.map((row) => [...(row || [])]);

/**
 * @param {State} state
 * @param {number} grid
 */
export function setCurrentGrid(state, grid) {
  state.currentGrid = Math.max(0, grid || 0);
}

/**
 * @param {State} state
 * @param {number} mu
 */
export function setCurrentMu(state, mu) {
  state.currentMu = Math.max(0, mu || 0);
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
  state.isPlaying = timer !== null;
}

/**
 * @param {State} state
 * @param {number} position
 */
export function setReplayPosition(state, position) {
  state.replayPosition = position;
}

/**
 * @param {State} state
 * @param {ReplayBackup} backup
 */
export function pushReplayBackup(state, backup) {
  state.replayBackups.push(backup);
}

/**
 * @param {State} state
 * @returns {ReplayBackup | undefined}
 */
export function popReplayBackup(state) {
  return state.replayBackups.pop();
}

/**
 * Replace one MU's rows; a row left out keeps its value.
 *
 * @param {State} state
 * @param {number} mu
 * @param {{ spikes?: number[], pulseTrain?: number[], artifactTimes?: number[] }} rows
 */
export function setMuRows(state, mu, { spikes, pulseTrain, artifactTimes }) {
  if (spikes) state.spikeTimes[mu] = spikes;
  if (pulseTrain) state.pulseTrains[mu] = pulseTrain;
  if (artifactTimes) state.artifactTimes[mu] = artifactTimes;
}

/**
 * @param {State} state
 * @param {EditLogEntry[]} history
 */
export function setHistory(state, history) {
  state.history = history;
}

/**
 * The timeline's groups, and the marks the log puts on MUs.
 *
 * @param {State} state
 * @param {ReplayGroup[]} groups
 * @param {Record<string, string>} marks
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
export function setFilteredReplayGroups(state, groups) {
  state.filteredReplayGroups = groups;
}

/**
 * Keep `base` as the replay's starting point and put a copy of it in view, at step 0.
 *
 * @param {State} state
 * @param {ReplayBase} base
 */
export function setReplayBase(state, base) {
  state.replayBaseSpikeTimes = copyRows(base.spikeTimes);
  state.replayBasePulseTrains = copyRows(base.pulseTrains);
  state.replayBaseArtifactTimes = copyRows(base.artifactTimes);
  restoreReplayBase(state);
}

/**
 * Back to step 0: a fresh copy of the replay base, no backups, the whole recording in view.
 *
 * @param {State} state
 */
export function restoreReplayBase(state) {
  state.replayBackups = [];
  state.replayPosition = 0;
  state.replayView = null;
  if (state.replayBaseSpikeTimes.length)
    state.spikeTimes = copyRows(state.replayBaseSpikeTimes);
  if (state.replayBasePulseTrains.length)
    state.pulseTrains = copyRows(state.replayBasePulseTrains);
  if (state.replayBaseArtifactTimes.length)
    state.artifactTimes = copyRows(state.replayBaseArtifactTimes);
}
