/**
 * Replay operations: pure functions that apply a logged step's diff forward or
 * backward, the predicates the replay engine groups steps with, and the
 * clamping of values and views to their bounds.
 */

/**
 * `row` with `removed` taken out and then `added` put in: sorted, unique and non-negative.
 *
 * @param {number[]} row
 * @param {number[]} added
 * @param {number[]} removed
 * @returns {number[]}
 */
export function applyDiff(row, added, removed) {
  const current = new Set(row);
  removed.forEach((n) => current.delete(n));
  added.forEach((n) => current.add(n));
  return [...current].filter((n) => n >= 0).sort((a, b) => a - b);
}

/**
 * Whether a step edits artifact markers rather than discharges.
 *
 * @param {Pick<import("../state/state.js").EditLogEntry, "type">} step
 */
export function isArtifactStep(step) {
  const { type } = step;
  return type === "add_artifact" || type === "delete_artifact";
}

/**
 * @param {Pick<import("../state/state.js").EditLogEntry, "type">} step
 * @returns {boolean}
 */
export function isSpikeEditStep(step) {
  const { type } = step;
  return (
    type === "add_spikes" ||
    type === "delete_spikes" ||
    type === "delete_dr" ||
    type === "remove_outliers"
  );
}

/**
 * The MUs flagged or removed before `editHistory[stepIdx]`, as indices into
 * `muUids`. MUedit2 leaves them out of an `update_filter` peel-off; any other
 * edit to a flagged MU clears its flag, as it does in MUedit2's session.
 *
 * @param {Pick<import("../state/state.js").EditLogEntry, "type" | "muUid" | "flagged" | "removedMuUids">[]} editHistory
 * @param {number} stepIdx
 * @param {string[]} muUids
 * @returns {number[]}
 */
export function inactiveMusBefore(editHistory, stepIdx, muUids) {
  /** @type {Set<string>} */
  const flagged = new Set();
  /** @type {Set<string>} */
  const removed = new Set();
  for (const step of editHistory.slice(0, stepIdx)) {
    const { type } = step;
    if (type === "remove_flagged" || type === "remove_duplicates") {
      step.removedMuUids.forEach((uid) => removed.add(uid));
    } else if (!step.muUid) {
      continue;
    } else if (type === "flag_mu" && step.flagged) {
      flagged.add(step.muUid);
    } else {
      flagged.delete(step.muUid);
    }
  }
  return [...flagged, ...removed]
    .map((uid) => muUids.indexOf(uid))
    .filter((idx) => idx >= 0)
    .sort((a, b) => a - b);
}

/**
 * `v` held inside `[lo, hi]`; reversed bounds collapse to `lo`.
 *
 * @param {number} v
 * @param {number} lo
 * @param {number} hi
 * @returns {number}
 */
export function clamp(v, lo, hi) {
  return Math.max(lo, Math.min(hi, v));
}

/**
 * `[start, end)` shifted back inside a recording of `totalSamples`, keeping
 * its width where the recording is wide enough.
 *
 * @param {number} start
 * @param {number} end
 * @param {number} totalSamples
 * @returns {import("../app/context.js").Span}
 */
export function shiftViewInside(start, end, totalSamples) {
  if (start < 0) {
    end -= start;
    start = 0;
  }
  if (end > totalSamples) {
    start = Math.max(0, start - (end - totalSamples));
    end = totalSamples;
  }
  if (end <= start) end = Math.min(totalSamples, start + 1);
  return { start, end };
}
