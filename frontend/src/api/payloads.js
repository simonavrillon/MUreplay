/**
 * Backend JSON normalised at the boundary: a loaded session and its log
 * entries become the shapes the state holds.
 */

/** @typedef {import("../app/context.js").JsonObject} JsonObject */

/**
 * @param {JsonObject} source
 */
export function normalizeEditedPayload(source) {
  const pulseTrains = source.pulse_trains || source.pulseTrains;
  const distimes = source.discharge_times || source.distimes;
  if (!Array.isArray(pulseTrains) || !Array.isArray(distimes)) {
    throw new Error("Expected pulse_trains and discharge_times arrays");
  }

  const fsamp = Number(source.fsamp || source.fs || 2048) || 2048;
  const muCount = distimes.length;
  const gridNames =
    Array.isArray(source.grid_names) && source.grid_names.length
      ? source.grid_names.map((v) => String(v))
      : ["Grid 1"];
  const muGridIndex =
    Array.isArray(source.mu_grid_index) &&
    source.mu_grid_index.length === muCount
      ? source.mu_grid_index.map((v) => Number(v) || 0)
      : new Array(muCount).fill(0);
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

  return {
    fsamp,
    pulseTrains: pulseTrains.map((row) =>
      Array.isArray(row) ? row.map((n) => Number(n) || 0) : [],
    ),
    distimes: distimes.map((row) =>
      Array.isArray(row) ? row.map((n) => Number(n) || 0) : [],
    ),
    gridNames,
    muGridIndex,
    muUids,
    artifactTimes,
    artifactRegions,
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
    let start = NaN;
    let end = NaN;
    if (Array.isArray(row) && row.length === 2) {
      start = Number(row[0]);
      end = Number(row[1]);
    } else if (row && typeof row === "object") {
      const obj = /** @type {JsonObject} */ (row);
      start = Number(obj.start);
      end = Number(obj.end);
    }
    if (Number.isFinite(start) && Number.isFinite(end) && end > start) {
      regions.push([Math.round(start), Math.round(end)]);
    }
  }
  return regions;
}

/**
 * @param {JsonObject} entry
 * @param {number} idx
 * @param {string[]} muUids
 */
export function normalizeLogEntry(entry, idx, muUids) {
  if (!entry || typeof entry !== "object") return null;
  const timestamp = String(entry.timestamp || entry.time || `step-${idx + 1}`);
  const type = String(entry.type || entry.action || entry.op || "unknown");
  const muUid = entry.mu_uid ? String(entry.mu_uid) : "";
  let muIdx = toOptionalIndex(entry.mu_idx);
  if (muIdx < 0 && muUid) {
    muIdx = muUids.indexOf(muUid);
  }

  const viewStart = toOptionalInt(entry.view_start ?? entry.start);
  const viewEnd = toOptionalInt(entry.view_end ?? entry.end);
  const spikesAdded = asNumberArray(entry.spikes_added);
  const spikesRemoved = asNumberArray(entry.spikes_removed);
  const artifactsAdded = asNumberArray(entry.artifacts_added);
  const artifactsRemoved = asNumberArray(entry.artifacts_removed);
  const usePeeloff = !!entry.use_peeloff;
  const lockSpikes = !!entry.lock_spikes;

  return {
    idx,
    timestamp,
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
 * A logged MU index, or -1 when the entry does not carry one.
 *
 * Only a number or a numeric string is an index. `Number()` would turn
 * `null`, `""`, `false` and `[]` into a finite 0, which reads as "motor unit
 * 0" and suppresses the `mu_uid` lookup that should have resolved the entry --
 * so an edit log that identifies MUs by uid but serializes a missing index as
 * JSON `null` would replay every edit onto the first MU.
 *
 * @param {unknown} value
 * @returns {number}
 */
function toOptionalIndex(value) {
  if (typeof value === "number") return Number.isFinite(value) ? value : -1;
  if (typeof value === "string" && value.trim()) {
    const n = Number(value);
    return Number.isFinite(n) ? n : -1;
  }
  return -1;
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
 * @param {number | string} raw
 * @returns {number[]}
 */
function parseMaybeList(raw) {
  const txt = String(raw).trim();
  if (!txt) return [];
  const clean = txt.replace(/^\[/, "").replace(/\]$/, "");
  return clean
    .split(/[;|\s]+|,/)
    .map((v) => Number(v.trim()))
    .filter((n) => Number.isFinite(n));
}

/**
 * @param {number | string | unknown[] | null | undefined} value
 * @returns {number[]}
 */
function asNumberArray(value) {
  if (Array.isArray(value))
    return value.map((n) => Number(n)).filter((n) => Number.isFinite(n));
  if (typeof value === "string" && value.trim()) return parseMaybeList(value);
  return [];
}
