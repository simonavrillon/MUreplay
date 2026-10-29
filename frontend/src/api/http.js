/**
 * The HTTP layer under `client.js`: the tab's session id header, timeouts,
 * the success envelope, and the backend's error envelope as `ApiError`.
 */
/** @typedef {import("../app/context.js").JsonObject} JsonObject */

export const SESSION_HEADER = "X-MUreplay-Session";

/** How long a request may take before it is given up, unless it says otherwise. */
const REQUEST_TIMEOUT_MS = 120000;

/** One id per tab: the backend scopes what it holds to it and frees it when the tab closes. */
export const SESSION_ID = newSessionId();

function newSessionId() {
  if (typeof globalThis.crypto?.randomUUID === "function") {
    return globalThis.crypto.randomUUID();
  }
  // randomUUID needs a secure context, which a plain-http LAN address is not.
  return Array.from({ length: 32 }, () =>
    Math.floor(Math.random() * 16).toString(16),
  ).join("");
}

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
 * A success response, with the tab's session id sent; an error response
 * throws as `ApiError`.
 *
 * @param {string} url
 * @param {RequestInit} [options]
 * @param {number} [timeoutMs]
 * @returns {Promise<Response>}
 */
export async function apiFetch(
  url,
  options = {},
  timeoutMs = REQUEST_TIMEOUT_MS,
) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  const headers = new Headers(options.headers);
  headers.set(SESSION_HEADER, SESSION_ID);
  try {
    const res = await fetch(url, {
      ...options,
      headers,
      signal: controller.signal,
    });
    if (!res.ok) {
      throw await parseApiError(res);
    }
    return res;
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
 * A success response's `data`: every JSON route wraps its answer in the envelope.
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
  const res = await apiFetch(url, options, timeoutMs);
  return (await res.json()).data;
}
