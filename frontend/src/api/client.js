/**
 * The API client: the one module that calls the backend. Each method is one
 * route, with its method and JSON body.
 */
import { API_BASE, routes } from "./routes.js";

/** @typedef {import("../app/context.js").JsonObject} JsonObject */

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
    healthUrl() {
      return urlOf(routes.health);
    },

    /** @param {string} filePath */
    loadPairedFromPath(filePath) {
      return apiJson(
        urlOf(routes.loadPairedFromPath),
        jsonPost({ file_path: filePath }),
      );
    },

    openFileDialog() {
      return apiJson(urlOf(routes.dialogOpenFile));
    },

    /** @param {JsonObject} payload */
    updateFilter(payload) {
      return apiJson(urlOf(routes.editUpdateFilter), jsonPost(payload));
    },
  };
}
