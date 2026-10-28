/**
 * The API client: the one module that calls the backend. Each method is one
 * route, with its method and JSON body.
 */
import { API_BASE, routes } from "./routes.js";

/** @typedef {import("../app/context.js").JsonObject} JsonObject */

/**
 * Longer than the 120 s the server keeps its file dialog open, so the
 * server's "File dialog timed out" arrives before this request gives up.
 */
const DIALOG_TIMEOUT_MS = 130000;

/**
 * @param {JsonObject} body
 * @returns {RequestInit}
 */
function jsonPost(body) {
  return {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  };
}

/** @param {string} route */
const urlOf = (route) => `${API_BASE}${route}`;

/**
 * @param {{ apiJson: typeof import("./http.js").apiJson }} deps
 */
export function createApiClient({ apiJson }) {
  return {
    /** @param {string} filePath */
    loadPairedFromPath(filePath) {
      return apiJson(
        urlOf(routes.loadPairedFromPath),
        jsonPost({ file_path: filePath }),
      );
    },

    openFileDialog() {
      return apiJson(urlOf(routes.dialogOpenFile), {}, DIALOG_TIMEOUT_MS);
    },

    /** @param {JsonObject} payload */
    updateFilter(payload) {
      return apiJson(urlOf(routes.editUpdateFilter), jsonPost(payload));
    },
  };
}
