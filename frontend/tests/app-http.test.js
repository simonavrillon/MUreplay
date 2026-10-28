// The fetch seam: error messages, envelopes, timeouts and the backend wait.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  ApiError,
  RequestTimeout,
  apiFetch,
  apiJson,
  waitForBackend,
} from "../src/app/http.js";

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

describe("apiFetch", () => {
  test("resolves on a 2xx response", async () => {
    stubBehavior = () => fakeResponse({ fine: true }, { status: 200 });
    const res = await apiFetch("http://api/health");
    assert.equal(res.status, 200);
    assert.equal(recorded[0].url, "http://api/health");
    // The request carries the abort signal of the internal timeout.
    assert.ok(recorded[0].init.signal instanceof AbortSignal);
  });

  test("throws the backend error message", async () => {
    stubBehavior = () =>
      fakeResponse({ error: { message: "file not found" } }, { status: 404 });
    await assert.rejects(
      apiFetch("http://api/load", {}, 5000),
      /file not found/,
    );
  });

  test("carries the status, code and field of the error envelope", async () => {
    stubBehavior = () =>
      fakeResponse(
        {
          error: {
            code: "http_404",
            message: "File not found: /x.npz.",
            detail: { field: "file_path" },
          },
        },
        { status: 404 },
      );
    const err = await apiFetch("http://api/load").catch((e) => e);
    assert.ok(err instanceof ApiError);
    assert.equal(err.message, "File not found: /x.npz.");
    assert.equal(err.status, 404);
    assert.equal(err.code, "http_404");
    assert.equal(err.field, "file_path");
  });

  test("formats FastAPI validation details with location", async () => {
    stubBehavior = () =>
      fakeResponse(
        {
          error: {
            code: "validation_error",
            message: "Request validation failed",
            detail: [{ loc: ["body", "file_path"], msg: "field required" }],
          },
        },
        { status: 422 },
      );
    await assert.rejects(
      apiFetch("http://api/load"),
      /^ApiError: Request validation failed: body\.file_path field required$/,
    );
  });

  test("falls back to the HTTP status on unparseable bodies", async () => {
    stubBehavior = () =>
      fakeResponse("<html>oops</html>", { status: 500, jsonError: true });
    await assert.rejects(apiFetch("http://api/load"), /^ApiError: HTTP 500$/);
  });

  test("reports a timeout as RequestTimeout", async () => {
    stubBehavior = (_url, init) =>
      new Promise((_resolve, reject) => {
        init.signal.addEventListener("abort", () => {
          const err = new Error("The operation was aborted");
          err.name = "AbortError";
          reject(err);
        });
      });
    await assert.rejects(apiFetch("http://api/slow", {}, 25), RequestTimeout);
  });

  test("rethrows non-timeout failures untouched", async () => {
    stubBehavior = () => Promise.reject(new TypeError("network down"));
    await assert.rejects(apiFetch("http://api/x"), /network down/);
  });
});

describe("apiJson", () => {
  test("unwraps the data envelope", async () => {
    stubBehavior = () => fakeResponse({ data: { unwrapped: true } });
    const payload = await apiJson("http://api/config");
    assert.deepEqual(payload, { unwrapped: true });
  });

  test("returns the payload as-is when there is no envelope", async () => {
    stubBehavior = () => fakeResponse({ health: "ok" });
    const payload = await apiJson("http://api/health");
    assert.deepEqual(payload, { health: "ok" });
  });
});

describe("waitForBackend", () => {
  test("resolves true once health checks pass", async () => {
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

  test("keeps polling while the connection is refused", async () => {
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

  test("returns false when the deadline passes", async () => {
    stubBehavior = () => fakeResponse({}, { status: 503 });
    const ok = await waitForBackend("http://api/health", {
      intervalMs: 1,
      timeoutMs: 20,
    });
    assert.equal(ok, false);
  });
});
