/**
 * Reads of `state` that need derivation; use these where one exists.
 */

/** @typedef {import("./state.js").State} State */
/** @typedef {import("./state.js").EditLogEntry} EditLogEntry */
/** @typedef {import("../app/context.js").Span} Span */

/**
 * The MUs of grid `grid`, in file order.
 *
 * @param {State} state
 * @param {number} grid
 * @returns {number[]}
 */
export function musForGrid(state, grid) {
  return state.muGridIndex.flatMap((g, mu) => (g === grid ? [mu] : []));
}

/**
 * The group behind the playhead, as the timeline shows it.
 *
 * @param {State} state
 * @returns {EditLogEntry | null}
 */
export function currentStep(state) {
  const group = state.timelineGroups[state.replayPosition - 1];
  return group ? group.displayStep : null;
}

/**
 * The step behind the playhead when it is on the current MU, else `null`.
 *
 * @param {State} state
 * @returns {EditLogEntry | null}
 */
export function currentMuStep(state) {
  const step = currentStep(state);
  return step && step.mu === state.currentMu ? step : null;
}

/**
 * @param {State} state
 * @returns {number[]}
 */
export function spikesForCurrentMu(state) {
  return state.spikeTimes[state.currentMu] ?? [];
}

/**
 * @param {State} state
 * @returns {number[]}
 */
export function pulseTrainForCurrentMu(state) {
  return state.pulseTrains[state.currentMu] ?? [];
}

/**
 * @param {State} state
 * @returns {number[]}
 */
export function artifactsForCurrentMu(state) {
  return state.artifactTimes[state.currentMu] ?? [];
}

/**
 * The samples in view: the zoomed window, kept inside `totalSamples`, or all of them before one is set.
 *
 * @param {State} state
 * @param {number} totalSamples
 * @returns {Span}
 */
export function clampedReplayView(state, totalSamples) {
  const view = state.replayView;
  if (!view || totalSamples <= 0) return { start: 0, end: totalSamples };
  const start = Math.max(0, Math.min(totalSamples - 1, view.start));
  const end = Math.max(start + 1, Math.min(totalSamples, view.end));
  return { start, end };
}
