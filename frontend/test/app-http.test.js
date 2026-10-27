import { test } from "node:test";
import assert from "node:assert/strict";
import { apiFetch, apiJson, waitForBackend } from "../src/app/http.js";

/**
 * What a stubbed fetch may hand back: a Response stand-in, a promise for one,
 * or a rejection.
 * @typedef {any} StubResult
 */

/**
 * Minimal Response stand-in: enough for the http seam (ok, status, json).
 * @param {unknown} payload
 * @param {{ ok?: boolean, status?: number, jsonError?: boolean }} [opts]
 * @returns {StubResult}
 */
function fakeResponse(payload, opts = {}) {
  return {
    ok: opts.ok ?? (opts.status ?? 200) < 400,
    status: opts.status ?? 200,
    json: async () => {
      if (opts.jsonError) throw new Error("not JSON");
      return payload;
    },
  };
}

/** Installs a per-test fetch stub and records the calls it serves. */
const originalFetch = globalThis.fetch;
/** @type {{ url: any, init: any }[]} */
const recorded = [];
/** @type {(url?: any, init?: any) => StubResult} */
const defaultBehavior = () => fakeResponse({});
let stubBehavior = defaultBehavior;

test.beforeEach(() => {
  recorded.length = 0;
  // Reset the stub as well as the log, so a test that forgets to set one
  // fails on its own terms instead of inheriting the previous test's.
  stubBehavior = defaultBehavior;
  // A stand-in cannot satisfy the full fetch signature, and does not need to:
  // the http seam only awaits it and reads ok/status/json.
  globalThis.fetch = /** @type {any} */ (
    (url, init) => {
      recorded.push({ url, init });
      return stubBehavior(url, init);
    }
  );
});

test.afterEach(() => {
  globalThis.fetch = originalFetch;
});

test("apiFetch resolves on a 2xx response", async () => {
  stubBehavior = () => fakeResponse({ fine: true }, { status: 200 });
  const res = await apiFetch("http://api/health");
  assert.equal(res.status, 200);
  assert.equal(recorded[0].url, "http://api/health");
  // The request carries the abort signal of the internal timeout.
  assert.ok(recorded[0].init.signal instanceof AbortSignal);
});

test("apiFetch throws the backend error message", async () => {
  stubBehavior = () =>
    fakeResponse({ error: { message: "file not found" } }, { status: 404 });
  await assert.rejects(apiFetch("http://api/load", {}, 5000), /file not found/);
});

test("apiFetch appends a string detail to the message", async () => {
  stubBehavior = () =>
    fakeResponse(
      { error: { message: "bad request" }, detail: "bad path" },
      {
        status: 400,
      },
    );
  await assert.rejects(
    apiFetch("http://api/load"),
    /^Error: bad request: bad path$/,
  );
});

test("apiFetch formats FastAPI validation details with location", async () => {
  stubBehavior = () =>
    fakeResponse(
      {
        error: { message: "validation failed" },
        detail: [{ loc: ["body", "file_path"], msg: "field required" }],
      },
      { status: 422 },
    );
  await assert.rejects(
    apiFetch("http://api/load"),
    /^Error: validation failed: body\.file_path field required$/,
  );
});

test("apiFetch falls back to the HTTP status on unparseable bodies", async () => {
  stubBehavior = () =>
    fakeResponse("<html>oops</html>", { status: 500, jsonError: true });
  await assert.rejects(apiFetch("http://api/load"), /^Error: HTTP 500$/);
});

test("apiFetch surfaces backend detail objects without a message field", async () => {
  stubBehavior = () =>
    fakeResponse({ detail: { reason: "server exploded" } }, { status: 500 });
  await assert.rejects(
    apiFetch("http://api/load"),
    /^Error: HTTP 500: server exploded$/,
  );
});

test("apiFetch reports timeouts as a plain error", async () => {
  stubBehavior = (_url, init) =>
    new Promise((_resolve, reject) => {
      init.signal.addEventListener("abort", () => {
        const err = new Error("The operation was aborted");
        err.name = "AbortError";
        reject(err);
      });
    });
  await assert.rejects(
    apiFetch("http://api/slow", {}, 25),
    /^Error: Request timed out$/,
  );
});

test("apiFetch rethrows non-timeout failures untouched", async () => {
  stubBehavior = () => Promise.reject(new TypeError("network down"));
  await assert.rejects(apiFetch("http://api/x"), /network down/);
});

test("apiJson unwraps the data envelope", async () => {
  stubBehavior = () => fakeResponse({ data: { unwrapped: true } });
  const payload = await apiJson("http://api/config");
  assert.deepEqual(payload, { unwrapped: true });
});

test("apiJson returns the payload as-is when there is no envelope", async () => {
  stubBehavior = () => fakeResponse({ health: "ok" });
  const payload = await apiJson("http://api/health");
  assert.deepEqual(payload, { health: "ok" });
});

test("waitForBackend resolves true once health checks pass", async () => {
  let attempts = 0;
  stubBehavior = () => {
    attempts += 1;
    return attempts === 1
      ? fakeResponse({}, { status: 503 })
      : fakeResponse({ status: "ok" });
  };
  const ok = await waitForBackend("http://api/health", {
    intervalMs: 1,
    timeoutMs: 1000,
  });
  assert.equal(ok, true);
  assert.equal(attempts, 2);
});

test("waitForBackend keeps polling while the connection is refused", async () => {
  // Before the server binds its port, fetch rejects rather than returning a
  // non-ok response -- which is the normal first phase of every app start.
  let attempts = 0;
  stubBehavior = () => {
    attempts += 1;
    if (attempts < 3) return Promise.reject(new TypeError("fetch failed"));
    return fakeResponse({ status: "ok" });
  };
  const ok = await waitForBackend("http://api/health", {
    intervalMs: 1,
    timeoutMs: 1000,
  });
  assert.equal(ok, true);
  assert.equal(attempts, 3);
});

test("waitForBackend returns false when the deadline passes", async () => {
  stubBehavior = () => fakeResponse({}, { status: 503 });
  const ok = await waitForBackend("http://api/health", {
    intervalMs: 1,
    timeoutMs: 20,
  });
  assert.equal(ok, false);
});
