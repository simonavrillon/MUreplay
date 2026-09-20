/**
 * Replay operations: spike/artifact diff application for forward/backward replay.
 * These are pure functions that manipulate distimes arrays based on logged diffs.
 */

/**
 * @param {number[]} distimes
 * @param {{ spikesAdded?: number[], spikesRemoved?: number[] }} step
 * @returns {number[]}
 */
export function applyLoggedDiffForward(distimes, step) {
  const current = new Set((distimes || []).map((n) => Number(n)));
  const added = Array.isArray(step.spikesAdded) ? step.spikesAdded : [];
  const removed = Array.isArray(step.spikesRemoved) ? step.spikesRemoved : [];
  removed.forEach((n) => current.delete(Number(n)));
  added.forEach((n) => current.add(Number(n)));
  return [...current]
    .filter((n) => Number.isFinite(n) && n >= 0)
    .sort((a, b) => a - b);
}

/**
 * @param {number[]} distimes
 * @param {{ spikesAdded?: number[], spikesRemoved?: number[] }} step
 * @returns {number[]}
 */
export function applyLoggedDiffBackward(distimes, step) {
  const current = new Set((distimes || []).map((n) => Number(n)));
  const added = Array.isArray(step.spikesAdded) ? step.spikesAdded : [];
  const removed = Array.isArray(step.spikesRemoved) ? step.spikesRemoved : [];
  added.forEach((n) => current.delete(Number(n)));
  removed.forEach((n) => current.add(Number(n)));
  return [...current]
    .filter((n) => Number.isFinite(n) && n >= 0)
    .sort((a, b) => a - b);
}

/**
 * @param {any} step
 * @returns {boolean}
 */
export function isSpikeEditStep(step) {
  const type = String(step?.type || "").toLowerCase();
  return (
    type === "add_spikes" ||
    type === "delete_spikes" ||
    type === "delete_dr" ||
    type === "remove_outliers"
  );
}

/**
 * @param {any} step
 * @returns {string}
 */
export function stepMuKey(step) {
  if (step?.muUid) return `uid:${step.muUid}`;
  if (Number.isFinite(step?.muIdx) && step.muIdx >= 0)
    return `idx:${step.muIdx}`;
  return "unknown";
}
