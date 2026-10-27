/**
 * Replay operations: spike/artifact diff application for forward/backward replay.
 * These are pure functions that manipulate distimes arrays based on logged diffs.
 */

/**
 * @param {number[] | null | undefined} distimes
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
 * @param {number[] | null | undefined} distimes
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
 * The MUs flagged or removed before `history[stepIdx]`, as indices into
 * `muUids`. MUedit2 leaves them out of an `update_filter` peel-off; any other
 * edit to a flagged MU clears its flag, as it does in MUedit2's session.
 *
 * @param {{ type?: string, muUid?: string, raw?: any }[]} history
 * @param {number} stepIdx
 * @param {string[]} muUids
 * @returns {number[]}
 */
export function inactiveMusBefore(history, stepIdx, muUids) {
  /** @type {Set<string>} */
  const flagged = new Set();
  /** @type {Set<string>} */
  const removed = new Set();
  for (const step of history.slice(0, stepIdx)) {
    const type = String(step?.type || "").toLowerCase();
    if (type === "remove_flagged" || type === "remove_duplicates") {
      const uids = step.raw?.removed_mu_uids;
      if (Array.isArray(uids)) uids.forEach((uid) => removed.add(String(uid)));
    } else if (!step?.muUid) {
      continue;
    } else if (type === "flag_mu" && step.raw?.flagged !== false) {
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
 * @param {any} step
 * @returns {string}
 */
export function stepMuKey(step) {
  if (step?.muUid) return `uid:${step.muUid}`;
  if (Number.isFinite(step?.muIdx) && step.muIdx >= 0)
    return `idx:${step.muIdx}`;
  return "unknown";
}
