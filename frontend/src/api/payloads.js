/**
 * Backend answers normalised at the boundary: an opened replay session, its
 * log entries and what a seek changed become the shapes the state holds.
 * Past this module no code reads a snake_case key. The backend types the
 * decomposition's fields, its uids and its run settings, so only what it
 * passes through from the user's files unchecked is checked here: the log.
 */

/** @typedef {import("../app/context.js").JsonObject} JsonObject */
/** @typedef {import("../state/state.js").EditLogEntry} EditLogEntry */
/** @typedef {import("./binary-payloads.js").ReplaySessionFrame} ReplaySessionFrame */

/**
 * @param {JsonObject} raw
 * @returns {import("../app/context.js").ProjectList}
 */
export function normalizeProjectList(raw) {
  return { projects: raw.projects, dataRoot: raw.data_root };
}

/**
 * The data folder the dialog picked, `null` when the dialog was cancelled.
 *
 * @param {JsonObject} raw
 * @returns {{ dataRoot: string | null }}
 */
export function normalizeDataFolder(raw) {
  return { dataRoot: raw.data_root };
}

/**
 * An opened replay session: its fields, and every MU's discharge times.
 *
 * @param {ReplaySessionFrame} frame
 */
export function normalizeSessionPayload({ meta: raw, spikeTimes }) {
  /** @type {string[]} */
  const muUids = raw.mu_uids;
  /** @type {EditLogEntry[]} */
  const editHistory = raw.edit_history.map((/** @type {JsonObject} */ entry) =>
    normalizeLogEntry(entry, muUids),
  );

  return {
    /** @type {string} */
    token: raw.token,
    /** @type {string} */
    sourceFilename: raw.source_filename,
    /** @type {string} */
    bidsRoot: raw.bids_root,
    /** @type {string} */
    entityLabel: raw.entity_label,
    /** @type {number} */
    fsamp: raw.fsamp,
    /** @type {number} */
    totalSamples: raw.total_samples,
    spikeTimes,
    /** @type {number[]} */
    versions: raw.versions,
    /** @type {string[]} */
    gridNames: raw.grid_names,
    /** @type {number[]} */
    muGridIndex: raw.mu_grid_index,
    muUids,
    /** @type {number[][]} */
    artifactRegions: raw.artifact_regions,
    parameters: normalizeParameters(raw.parameters ?? {}),
    sidecarMeta: normalizeSidecarMeta(raw.sidecar_meta ?? {}),
    editHistory,
  };
}

/**
 * What a seek changed: the discharges of the MUs it moved, every MU's
 * version, and the refits that fell back to the logged diff.
 *
 * @param {ReplaySessionFrame} frame
 * @returns {import("../state/state.js").ReplayChange}
 */
export function normalizeReplayChange({ meta, spikeTimes }) {
  return {
    changed: meta.changed,
    spikeTimes,
    versions: meta.versions,
    refitErrors: meta.refit_errors,
  };
}

/**
 * The run settings the settings panel shows; a key the file lacks is undefined.
 *
 * @param {JsonObject} raw
 */
function normalizeParameters(raw) {
  return {
    /** @type {number | undefined} */
    niter: raw.niter,
    /** @type {number | undefined} */
    nwindows: raw.nwindows,
    /** @type {number | undefined} */
    duplicatesthresh: raw.duplicatesthresh,
    /** @type {boolean | number | undefined} */
    peelOffEnabled: raw.peel_off_enabled,
    /** @type {number | undefined} Seconds. */
    peelOffWin: raw.peel_off_win,
    /** @type {boolean | number | undefined} */
    useAdaptive: raw.use_adaptive,
    /** @type {boolean | number | undefined} */
    fullTrace: raw.full_trace,
    /** @type {number | undefined} */
    silThr: raw.sil_thr,
    /** @type {boolean | number | undefined} */
    covFilter: raw.covfilter,
    /** @type {number | undefined} */
    covThr: raw.cov_thr,
  };
}

/**
 * The participant, placement and hardware fields the recording's BIDS
 * sidecars record, as the user wrote them: any value may be missing or odd.
 *
 * @param {JsonObject} raw
 */
function normalizeSidecarMeta(raw) {
  const participant = raw.participant_meta ?? {};
  return {
    participantMeta: {
      /** @type {unknown} */
      age: participant.age,
      /** @type {unknown} */
      sex: participant.sex,
      /** @type {unknown} */
      handedness: participant.handedness,
    },
    /** @type {unknown} */
    manufacturer: raw.manufacturer,
    /** @type {unknown} */
    manufacturersModelName: raw.manufacturers_model_name,
    /** @type {unknown} */
    powerlineFreq: raw.powerline_freq,
    /** @type {unknown} */
    placementScheme: raw.placement_scheme,
    /** @type {unknown} */
    placementSchemeDescription: raw.placement_scheme_description,
    /** @type {unknown} */
    groundLocation: raw.ground_location,
    /** @type {unknown} */
    referenceLocation: raw.reference_location,
    /** @type {unknown[]} */
    muscleNames: Array.isArray(raw.muscle_names) ? raw.muscle_names : [],
  };
}

/**
 * The backend sends only the log's object entries.
 *
 * @param {JsonObject} entry
 * @param {string[]} muUids
 * @returns {EditLogEntry}
 */
export function normalizeLogEntry(entry, muUids) {
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
