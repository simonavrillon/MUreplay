/**
 * The API client: the one module that calls the backend. Each method is one
 * route, with its method and body, and the decoding of its answer.
 */
import {
  decodePulseFrame,
  decodeReplaySessionFrame,
} from "./binary-payloads.js";
import { API_BASE, routes } from "./routes.js";

/** @typedef {import("../app/context.js").JsonObject} JsonObject */

/**
 * Longer than the 120 s the server keeps its folder dialog open, so the
 * server's "Folder dialog timed out" arrives before this request gives up.
 */
const DIALOG_TIMEOUT_MS = 130000;
/**
 * Filtering one grid takes a while on long recordings; a refit waits for it,
 * and so does a seek queued behind that refit.
 */
const GRID_FILTER_TIMEOUT_MS = 600000;

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

/** @param {Record<string, unknown>} params */
function queryOf(params) {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null) query.set(key, String(value));
  }
  return query;
}

/** @param {string} route */
const urlOf = (route) => `${API_BASE}${route}`;

/**
 * @param {{ apiFetch: typeof import("./http.js").apiFetch, apiJson: typeof import("./http.js").apiJson, sessionId: string }} deps
 */
export function createApiClient({ apiFetch, apiJson, sessionId }) {
  /**
   * POST JSON and decode the replay-session frame it answers with.
   *
   * @param {string} route
   * @param {JsonObject} body
   * @param {number} [timeoutMs]
   */
  async function postForSession(route, body, timeoutMs) {
    const res = await apiFetch(urlOf(route), jsonPost(body), timeoutMs);
    return decodeReplaySessionFrame(await res.arrayBuffer());
  }

  return {
    /**
     * Open the session paired with `filePath` on the server: its fields and
     * every MU's discharge times. The pulse trains stay on the server.
     *
     * @param {string} filePath
     */
    replayOpen(filePath) {
      return postForSession(routes.replaySessionOpen, { file_path: filePath });
    },

    /**
     * Move the server's replay to exactly `steps` of the edit log; the frame
     * says what changed.
     *
     * @param {{ token: string, steps: number[] }} payload
     */
    replaySeek(payload) {
      return postForSession(routes.replaySeek, payload, GRID_FILTER_TIMEOUT_MS);
    },

    /**
     * Filter a grid's EMG on the server ahead of its first refit.
     *
     * @param {{ token: string, grid: number }} payload
     */
    async replayPrepareGrid(payload) {
      await apiFetch(
        urlOf(routes.replayPrepareGrid),
        jsonPost(payload),
        GRID_FILTER_TIMEOUT_MS,
      );
    },

    /**
     * One MU's pulse train over `[start, end)` in `bins` bins, with the
     * discharges and artifact markers in that window.
     *
     * @param {{ token: string, mu: number, start: number, end: number, bins: number }} params
     */
    async fetchPulse(params) {
      const res = await apiFetch(
        `${urlOf(routes.seriesPulse)}?${queryOf(params)}`,
        {
          method: "GET",
          headers: { Accept: "application/octet-stream" },
        },
      );
      return decodePulseFrame(await res.arrayBuffer());
    },

    /**
     * Frees what the backend holds for this tab. `keepalive` lets the request
     * outlive the page being unloaded; the backend reads the session from the
     * query, not the header.
     */
    closeSession() {
      apiFetch(
        `${urlOf(routes.sessionClose)}?${queryOf({ session: sessionId })}`,
        { method: "POST", keepalive: true },
      ).catch(() => {});
    },

    listProjects() {
      return apiJson(urlOf(routes.projects));
    },

    /** Pick another data folder in the native dialog; the server remembers it. */
    chooseDataFolder() {
      return apiJson(
        urlOf(routes.dialogDataFolder),
        { method: "POST" },
        DIALOG_TIMEOUT_MS,
      );
    },
  };
}
