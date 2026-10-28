/**
 * Backend JSON normalised at the boundary: a loaded session and its log
 * entries become the shapes the state holds.
 */

/** @typedef {import("../app/context.js").JsonObject} JsonObject */

/**
 * @param {JsonObject} source
 */
export function normalizeEditedPayload(source) {
  const pulseTrains = source.pulse_trains;
  const spikeTimes = source.spike_times;
  if (!Array.isArray(pulseTrains) || !Array.isArray(spikeTimes)) {
    throw new Error("Expected pulse_trains and spike_times arrays");
  }

  // The backend fills fsamp, grid_names and one mu_grid_index entry per MU.
  const fsamp = Number(source.fsamp);
  const muCount = spikeTimes.length;
  const gridNames = source.grid_names.map((/** @type {unknown} */ v) =>
    String(v),
  );
  const muGridIndex = source.mu_grid_index.map(
    (/** @type {unknown} */ v) => Number(v) || 0,
  );
  const muUids =
    Array.isArray(source.mu_uids) && source.mu_uids.length === muCount
      ? source.mu_uids.map((v) => String(v))
      : buildMuUids(muGridIndex);

  const artifactTimes = Array.isArray(source.artifact_times)
    ? source.artifact_times.map((row) =>
        Array.isArray(row) ? row.map(Number) : [],
      )
    : [];

  const artifactRegions = normalizeArtifactRegions(source.artifact_regions);
  const refitSettings = normalizeRefitSettings(source.parameters);

  return {
    fsamp,
    pulseTrains: pulseTrains.map((row) =>
      Array.isArray(row) ? row.map((n) => Number(n) || 0) : [],
    ),
    spikeTimes: spikeTimes.map((row) =>
      Array.isArray(row) ? row.map((n) => Number(n) || 0) : [],
    ),
    gridNames,
    muGridIndex,
    muUids,
    artifactTimes,
    artifactRegions,
    refitSettings,
  };
}

/**
 * The run settings a filter refit uses, from the decomposition's saved
 * parameters; MUedit2's defaults where the file has none.
 *
 * @param {unknown} raw
 * @returns {import("../state/state.js").RefitSettings}
 */
function normalizeRefitSettings(raw) {
  const params =
    raw && typeof raw === "object" ? /** @type {JsonObject} */ (raw) : {};
  const nbextchan = Number(params.nbextchan);
  const peelOffWin = Number(params.peel_off_win);
  return {
    nbextchan: Number.isInteger(nbextchan) && nbextchan > 0 ? nbextchan : 1000,
    peelOffWin: peelOffWin > 0 ? peelOffWin : 0.025,
    computeDtype: params.compute_dtype === "float64" ? "float64" : "float32",
  };
}

/**
 * MU uids as MUedit2 numbers the MUs of a file that has none: per grid, from 0.
 *
 * @param {(number | null | undefined)[]} muGridIndex
 * @returns {string[]}
 */
export function buildMuUids(muGridIndex) {
  /** @type {Record<number, number>} */
  const counts = {};
  return muGridIndex.map((gridIdx) => {
    const k = Number(gridIdx) || 0;
    const n = counts[k] || 0;
    counts[k] = n + 1;
    return `g${k}_mu${n}`;
  });
}

/**
 * @param {unknown} raw
 * @returns {number[][]}
 */
function normalizeArtifactRegions(raw) {
  if (!Array.isArray(raw)) return [];
  const regions = [];
  for (const row of raw) {
    if (!Array.isArray(row) || row.length !== 2) continue;
    const start = Number(row[0]);
    const end = Number(row[1]);
    if (Number.isFinite(start) && Number.isFinite(end) && end > start) {
      regions.push([Math.round(start), Math.round(end)]);
    }
  }
  return regions;
}

/**
 * @param {JsonObject} entry
 * @param {string[]} muUids
 */
export function normalizeLogEntry(entry, muUids) {
  if (!entry || typeof entry !== "object") return null;
  const type = String(entry.type || "unknown");
  const muUid = entry.mu_uid ? String(entry.mu_uid) : "";
  const muIdx = muUid ? muUids.indexOf(muUid) : -1;

  const viewStart = toOptionalInt(entry.view_start);
  const viewEnd = toOptionalInt(entry.view_end);
  const spikesAdded = asNumberArray(entry.spikes_added);
  const spikesRemoved = asNumberArray(entry.spikes_removed);
  const artifactsAdded = asNumberArray(entry.artifacts_added);
  const artifactsRemoved = asNumberArray(entry.artifacts_removed);
  const usePeeloff = !!entry.use_peeloff;
  const lockSpikes = !!entry.lock_spikes;

  return {
    type,
    muUid,
    muIdx,
    viewStart,
    viewEnd,
    spikesAdded,
    spikesRemoved,
    artifactsAdded,
    artifactsRemoved,
    usePeeloff,
    lockSpikes,
    raw: entry,
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
function asNumberArray(value) {
  if (!Array.isArray(value)) return [];
  return value.map((n) => Number(n)).filter((n) => Number.isFinite(n));
}
