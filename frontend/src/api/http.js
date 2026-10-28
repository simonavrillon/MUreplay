/**
 * The HTTP layer under `client.js`: timeouts, the success envelope, and the
 * backend's error envelope as `ApiError`.
 */
/** @typedef {import("../app/context.js").JsonObject} JsonObject */

/** How long a request may take before it is given up, unless it says otherwise. */
const REQUEST_TIMEOUT_MS = 120000;

/**
 * An error response: its message, and what the backend's error envelope says
 * went wrong (`field` names the request field at fault, when one is).
 */
export class ApiError extends Error {
  /**
   * @param {string} message
   * @param {{ status: number, field?: string }} info
   */
  constructor(message, { status, field = "" }) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.field = field;
  }
}

/**
 * @param {Response} res
 * @returns {Promise<ApiError>}
 */
async function parseApiError(res) {
  let message = "The server could not complete the request.";
  let field = "";
  try {
    const err = (await res.json())?.error;
    if (typeof err?.message === "string" && err.message.trim()) {
      message = err.message.trim();
    }
    if (typeof err?.detail?.field === "string") field = err.detail.field;
  } catch {
    // Keep the generic message.
  }
  return new ApiError(message, { status: res.status, field });
}

/**
 * A success response's `data`: every route wraps its answer in the envelope.
 *
 * @param {string} url
 * @param {RequestInit} [options]
 * @param {number} [timeoutMs]
 * @returns {Promise<JsonObject>}
 */
export async function apiJson(
  url,
  options = {},
  timeoutMs = REQUEST_TIMEOUT_MS,
) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { ...options, signal: controller.signal });
    if (!res.ok) {
      throw await parseApiError(res);
    }
    return (await res.json()).data;
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") {
      // The server may still carry the request out.
      throw new Error("The server took too long to answer.");
    }
    throw err;
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * @param {string} healthUrl
 * @param {{ intervalMs?: number, timeoutMs?: number }} [options]
 * @returns {Promise<boolean>}
 */
export async function waitForBackend(
  healthUrl,
  { intervalMs = 500, timeoutMs = 60000 } = {},
) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(healthUrl, { signal: AbortSignal.timeout(2000) });
      if (res.ok) return true;
    } catch {
      // not ready yet
    }
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  return false;
}
