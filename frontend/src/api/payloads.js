/**
 * Backend JSON normalised at the boundary: a loaded session, its log entries
 * and a refit result become the shapes the state holds. Past this module no
 * code reads a snake_case key. The backend types the decomposition's arrays
 * and its run settings, so only what it passes through from the user's files
 * unchecked is checked here: the log, with its uids and artifact markers.
 */

/** @typedef {import("../app/context.js").JsonObject} JsonObject */
/** @typedef {import("../state/state.js").EditLogEntry} EditLogEntry */

/**
 * @param {JsonObject} raw
 */
export function normalizeSessionPayload(raw) {
  const muUids =
    Array.isArray(raw.mu_uids) && raw.mu_uids.length === raw.spike_times.length
      ? raw.mu_uids.map((v) => String(v))
      : buildMuUids(raw.mu_grid_index);

  /** @type {EditLogEntry[]} */
  const editHistory = [];
  for (const entry of raw.edit_history) {
    const step = normalizeLogEntry(entry, muUids);
    if (step) editHistory.push(step);
  }

  return {
    /** @type {string} */
    sourceFilename: raw.source_filename,
    /** @type {string} */
    bidsRoot: raw.bids_root,
    /** @type {string} */
    entityLabel: raw.entity_label,
    /** @type {number} */
    fsamp: raw.fsamp,
    /** @type {number[][]} */
    pulseTrains: raw.pulse_trains,
    /** @type {number[][]} */
    spikeTimes: raw.spike_times,
    /** @type {string[]} */
    gridNames: raw.grid_names,
    /** @type {number[]} */
    muGridIndex: raw.mu_grid_index,
    muUids,
    artifactTimes: artifactRows(raw.artifact_times, raw.spike_times.length),
    // No key when the decomposition has no artifact windows.
    /** @type {number[][]} */
    artifactRegions: raw.artifact_regions ?? [],
    /** @type {import("../state/state.js").RefitSettings} */
    refitSettings: {
      nbextchan: raw.refit_settings.nbextchan,
      peelOffWin: raw.refit_settings.peel_off_win,
      computeDtype: raw.refit_settings.compute_dtype,
    },
    editHistory,
  };
}

/**
 * The log's artifact markers as one row per MU, empty where it has none.
 *
 * @param {unknown} artifactTimes
 * @param {number} nMu
 * @returns {number[][]}
 */
function artifactRows(artifactTimes, nMu) {
  return Array.from({ length: nMu }, (_, mu) => {
    const row = Array.isArray(artifactTimes) ? artifactTimes[mu] : null;
    return Array.isArray(row) ? row.map(Number) : [];
  });
}

/**
 * MU uids as MUedit2 numbers the MUs of a file that has none: per grid, from 0.
 *
 * @param {number[]} muGridIndex
 * @returns {string[]}
 */
export function buildMuUids(muGridIndex) {
  /** @type {Record<number, number>} */
  const counts = {};
  return muGridIndex.map((grid) => {
    const n = counts[grid] || 0;
    counts[grid] = n + 1;
    return `g${grid}_mu${n}`;
  });
}

/**
 * @param {JsonObject} entry
 * @param {string[]} muUids
 * @returns {EditLogEntry | null}
 */
export function normalizeLogEntry(entry, muUids) {
  if (!entry || typeof entry !== "object") return null;
  const muUid = entry.mu_uid ? String(entry.mu_uid) : "";
  return {
    type: String(entry.type || "unknown").toLowerCase(),
    muUid,
    mu: muUid ? muUids.indexOf(muUid) : -1,
    viewStart: toOptionalInt(entry.view_start),
    viewEnd: toOptionalInt(entry.view_end),
    spikesAdded: toNumberArray(entry.spikes_added),
    spikesRemoved: toNumberArray(entry.spikes_removed),
    artifactsAdded: toNumberArray(entry.artifacts_added),
    artifactsRemoved: toNumberArray(entry.artifacts_removed),
    usePeeloff: !!entry.use_peeloff,
    lockSpikes: !!entry.lock_spikes,
    // MUedit2 writes `flagged: false` to unflag; a `flag_mu` without it flags.
    flagged: entry.flagged !== false,
    sourceMuUid: entry.source_mu_uid ? String(entry.source_mu_uid) : "",
    removedMuUids: Array.isArray(entry.removed_mu_uids)
      ? entry.removed_mu_uids.map((v) => String(v))
      : [],
  };
}

/**
 * An `update_filter` refit's new discharges and pulse train for its MU.
 *
 * @param {JsonObject} raw
 * @returns {{ spikes: number[], pulseTrain: number[] }}
 */
export function normalizeRefitResult(raw) {
  return { spikes: raw.spikes, pulseTrain: raw.pulse_train };
}

/**
 * @param {number | string | null | undefined} value
 * @returns {number | null}
 */
function toOptionalInt(value) {
  if (value == null || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? Math.round(n) : null;
}

/**
 * @param {unknown} value
 * @returns {number[]}
 */
function toNumberArray(value) {
  if (!Array.isArray(value)) return [];
  return value.map((n) => Number(n)).filter((n) => Number.isFinite(n));
}
