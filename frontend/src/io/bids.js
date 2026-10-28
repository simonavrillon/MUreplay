/**
 * BIDS file names: the entity label a decomposition or edit log is named after.
 */

/**
 * Last path segment of `filePath`, for either separator.
 *
 * The backend hands back native paths, so a session opened on Windows carries
 * backslashes. Splitting on "/" alone leaves the whole path as the "basename",
 * which then reaches `entityLabelFromFilename` and travels on as the BIDS entity
 * label.
 *
 * @param {string | null | undefined} filePath
 * @returns {string}
 */
export function basename(filePath) {
  const parts = String(filePath || "").split(/[\\/]/);
  return parts[parts.length - 1] || "";
}

/**
 * The entity label of a `_decomp`/`_edited` file name.
 *
 * @param {string | null | undefined} filename
 * @returns {string}
 */
export function entityLabelFromFilename(filename) {
  const base = String(filename || "").replace(/\.[^.]+$/, "");
  return base.replace(/_edited$/i, "").replace(/_decomp$/i, "");
}
