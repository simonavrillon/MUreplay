/**
 * Replay operations: the predicates the timeline groups and colours steps
 * with, the diff summary's counts, and the clamping of values and views to
 * their bounds. The server applies the steps (`replay/operations.py`).
 */

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

/**
 * The discharges `steps` added and removed on MU `mu`, by their logged diffs.
 *
 * @param {Pick<import("../state/state.js").EditLogEntry, "mu" | "spikesAdded" | "spikesRemoved">[]} steps
 * @param {number} mu
 */
export function dischargeDiff(steps, mu) {
  let added = 0;
  let removed = 0;
  for (const step of steps) {
    if (step.mu !== mu) continue;
    added += step.spikesAdded.length;
    removed += step.spikesRemoved.length;
  }
  return { added, removed };
}

/** Squares in a diff summary, as GitHub draws beside a commit's line counts. */
const DIFF_SQUARES = 5;

/**
 * The diff summary's squares: added, then removed, in proportion; all
 * neutral when there is no change.
 *
 * @param {number} added
 * @param {number} removed
 * @returns {("added" | "removed" | "neutral")[]}
 */
export function diffSquares(added, removed) {
  const total = added + removed;
  if (!total) return Array(DIFF_SQUARES).fill("neutral");
  const green = Math.round((added / total) * DIFF_SQUARES);
  return Array.from({ length: DIFF_SQUARES }, (_, i) =>
    i < green ? "added" : "removed",
  );
}
