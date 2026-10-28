/**
 * Replay operations: pure functions that apply a logged step's diff forward or
 * backward, and the predicates the replay engine groups steps with.
 */

/**
 * `row` with `removed` taken out and then `added` put in: sorted, unique, finite and non-negative.
 *
 * @param {number[] | null | undefined} row
 * @param {number[] | undefined} added
 * @param {number[] | undefined} removed
 * @returns {number[]}
 */
function applyDiff(row, added, removed) {
  const current = new Set((row || []).map((n) => Number(n)));
  (Array.isArray(removed) ? removed : []).forEach((n) =>
    current.delete(Number(n)),
  );
  (Array.isArray(added) ? added : []).forEach((n) => current.add(Number(n)));
  return [...current]
    .filter((n) => Number.isFinite(n) && n >= 0)
    .sort((a, b) => a - b);
}

/**
 * @param {number[] | null | undefined} distimes
 * @param {{ spikesAdded?: number[], spikesRemoved?: number[] }} step
 * @returns {number[]}
 */
export function applyLoggedDiffForward(distimes, step) {
  return applyDiff(distimes, step.spikesAdded, step.spikesRemoved);
}

/**
 * @param {number[] | null | undefined} distimes
 * @param {{ spikesAdded?: number[], spikesRemoved?: number[] }} step
 * @returns {number[]}
 */
export function applyLoggedDiffBackward(distimes, step) {
  return applyDiff(distimes, step.spikesRemoved, step.spikesAdded);
}

/**
 * @param {number[] | null | undefined} artifactTimes
 * @param {{ artifactsAdded?: number[], artifactsRemoved?: number[] }} step
 * @returns {number[]}
 */
export function applyArtifactDiffForward(artifactTimes, step) {
  return applyDiff(artifactTimes, step.artifactsAdded, step.artifactsRemoved);
}

/**
 * @param {number[] | null | undefined} artifactTimes
 * @param {{ artifactsAdded?: number[], artifactsRemoved?: number[] }} step
 * @returns {number[]}
 */
export function applyArtifactDiffBackward(artifactTimes, step) {
  return applyDiff(artifactTimes, step.artifactsRemoved, step.artifactsAdded);
}

/**
 * Whether a step edits artifact markers rather than discharges.
 *
 * @param {{ type?: string } | null | undefined} step
 */
export function isArtifactStep(step) {
  const type = String(step?.type || "").toLowerCase();
  return type === "add_artifact" || type === "delete_artifact";
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
