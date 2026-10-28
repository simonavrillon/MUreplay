/**
 * Reads of `state` that need derivation; use these where one exists.
 */
import { entityLabelFromFilename } from "../io/bids.js";
import { clamp } from "../replay/operations.js";
import { extent } from "../signal/series.js";

/** @typedef {import("./state.js").State} State */
/** @typedef {import("./state.js").EditLogEntry} EditLogEntry */
/** @typedef {import("./state.js").ReplayGroup} ReplayGroup */

/**
 * The MUs of grid `grid`, in file order.
 *
 * @param {State} state
 * @param {number} grid
 * @returns {number[]}
 */
export function musForGrid(state, grid) {
  return state.muGridIndex.flatMap((g, mu) =>
    (Number(g) || 0) === grid ? [mu] : [],
  );
}

/**
 * The first grid, in MU order, that holds an MU.
 *
 * @param {State} state
 */
export function firstGridWithMu(state) {
  return state.muGridIndex.length ? Number(state.muGridIndex[0]) || 0 : 0;
}

/**
 * The MU a log entry names, by index or else by uid; -1 when it names none.
 *
 * @param {State} state
 * @param {EditLogEntry | null | undefined} step
 */
export function resolveStepMuIndex(state, step) {
  if (Number.isFinite(step?.muIdx) && step && step.muIdx >= 0)
    return step.muIdx;
  if (step?.muUid) {
    const idx = state.muUids.indexOf(step.muUid);
    if (idx >= 0) return idx;
  }
  return -1;
}

/**
 * The timeline: the replay groups that touch the current MU.
 *
 * @param {State} state
 * @returns {ReplayGroup[]}
 */
export function getActiveReplayGroups(state) {
  return state.filteredReplayGroups;
}

/**
 * The group behind the playhead, as the timeline shows it.
 *
 * @param {State} state
 * @returns {EditLogEntry | null}
 */
export function currentStep(state) {
  const groups = getActiveReplayGroups(state);
  if (!groups.length || state.replayPosition <= 0) return null;
  const idx = clamp(state.replayPosition - 1, 0, groups.length - 1);
  return groups[idx]?.displayStep || null;
}

/**
 * @param {State} state
 * @param {EditLogEntry | null} step
 */
export function isCurrentMuStep(state, step) {
  return !!step && step.muIdx === state.currentMu;
}

/**
 * @param {State} state
 * @returns {number[]}
 */
export function distimesForCurrentMu(state) {
  const row = state.distimes[state.currentMu];
  return Array.isArray(row) ? row : [];
}

/**
 * @param {State} state
 * @returns {number[]}
 */
export function artifactTimesForCurrentMu(state) {
  return state.artifactTimes[state.currentMu] || [];
}

/**
 * The current MU's pulse train, or a binary one drawn from its discharges when none was loaded.
 *
 * @param {State} state
 * @returns {number[]}
 */
export function pulseForCurrentMu(state) {
  const pulse = state.pulseTrains[state.currentMu];
  if (Array.isArray(pulse) && pulse.length) return pulse;
  const spikes = distimesForCurrentMu(state);
  if (!spikes.length) return [];
  const synthetic = new Array(extent(spikes).max + 1).fill(0);
  spikes.forEach((s) => {
    if (s >= 0 && s < synthetic.length) synthetic[s] = 1;
  });
  return synthetic;
}

/**
 * The samples in view: the zoomed window, or all `total` before one is set.
 *
 * @param {State} state
 * @param {number} total
 * @returns {import("../app/context.js").Span}
 */
export function getReplayView(state, total) {
  const view = state.replayView;
  return view && view.end > view.start ? view : { start: 0, end: total };
}

/**
 * The BIDS dataset a filter refit reads the EMG from.
 *
 * @param {State} state
 */
export function getBidsRoot(state) {
  return state.bidsRoot || state.dataRoot;
}

/**
 * The BIDS entity label of the session's recording.
 *
 * @param {State} state
 */
export function getEntityLabel(state) {
  return (
    state.bidsEntityLabel ||
    state.entityLabel ||
    entityLabelFromFilename(state.editedFilename)
  );
}
