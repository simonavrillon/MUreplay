/**
 * API client seam. Wraps URL composition and response decoding so domain
 * modules never import routes directly. Created once in the container and
 * injected via deps.
 */
import { routes } from "./routes.js";

/** @typedef {import("../app/context.js").JsonObject} JsonObject */

/**
 * @param {{ apiJson: typeof import("../app/http.js").apiJson, API_BASE: string }} deps
 */
export function createApiClient({ apiJson, API_BASE }) {
  /**
   * @param {string} url
   * @param {JsonObject} body
   * @param {number} [timeoutMs]
   */
  function postJson(url, body, timeoutMs) {
    return apiJson(
      url,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      },
      timeoutMs,
    );
  }

  return {
    healthUrl() {
      return `${API_BASE}${routes.health}`;
    },

    /** @param {string} filePath */
    loadPairedFromPath(filePath) {
      return postJson(`${API_BASE}${routes.loadPairedFromPath}`, {
        file_path: filePath,
      });
    },

    async openFileDialog() {
      return apiJson(`${API_BASE}${routes.dialogOpenFile}`);
    },

    /** @param {JsonObject} payload */
    updateFilter(payload) {
      return postJson(`${API_BASE}${routes.editUpdateFilter}`, payload, 120000);
    },
  };
}
