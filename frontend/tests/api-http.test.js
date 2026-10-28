// The fetch seam: error messages, envelopes, timeouts and the backend wait.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { ApiError, apiJson, waitForBackend } from "../src/api/http.js";

/** What a stubbed fetch hands back: a Response stand-in, a promise for one, or a rejection. @typedef {any} StubResult */

/**
 * A Response stand-in with ok, status and json.
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

const originalFetch = globalThis.fetch;
/** @type {{ url: any, init: any }[]} */
const recorded = [];
/** @type {(url?: any, init?: any) => StubResult} */
const defaultBehavior = () => fakeResponse({});
let stubBehavior = defaultBehavior;

test.beforeEach(() => {
  recorded.length = 0;
  stubBehavior = defaultBehavior;
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

describe("apiJson", () => {
  test("unwraps the data envelope of a 2xx response", async () => {
    stubBehavior = () => fakeResponse({ data: { unwrapped: true } });
    const payload = await apiJson("http://api/health");
    assert.deepEqual(payload, { unwrapped: true });
    assert.equal(recorded[0].url, "http://api/health");
    // The request carries the abort signal of the internal timeout.
    assert.ok(recorded[0].init.signal instanceof AbortSignal);
  });

  test("throws the backend error message", async () => {
    stubBehavior = () =>
      fakeResponse({ error: { message: "file not found" } }, { status: 404 });
    await assert.rejects(
      apiJson("http://api/load", {}, 5000),
      /file not found/,
    );
  });

  test("carries the status and field of the error envelope", async () => {
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
    const err = await apiJson("http://api/load").catch((e) => e);
    assert.ok(err instanceof ApiError);
    assert.equal(err.message, "File not found: /x.npz.");
    assert.equal(err.status, 404);
    assert.equal(err.field, "file_path");
  });

  test("shows a validation error's message without Pydantic's details", async () => {
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
      apiJson("http://api/load"),
      /^ApiError: Request validation failed$/,
    );
  });

  test("falls back to a plain sentence on unparseable bodies", async () => {
    stubBehavior = () =>
      fakeResponse("<html>oops</html>", { status: 500, jsonError: true });
    const err = await apiJson("http://api/load").catch((e) => e);
    assert.equal(err.message, "The server could not complete the request.");
    assert.equal(err.status, 500);
  });

  test("reports a timeout in a plain sentence", async () => {
    stubBehavior = (_url, init) =>
      new Promise((_resolve, reject) => {
        init.signal.addEventListener("abort", () => {
          const err = new Error("The operation was aborted");
          err.name = "AbortError";
          reject(err);
        });
      });
    await assert.rejects(
      apiJson("http://api/slow", {}, 25),
      /^Error: The server took too long to answer\.$/,
    );
  });

  test("rethrows non-timeout failures untouched", async () => {
    stubBehavior = () => Promise.reject(new TypeError("network down"));
    await assert.rejects(apiJson("http://api/x"), /network down/);
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
