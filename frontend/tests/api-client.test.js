// The API client: each call's route, method, body and timeout.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { createApiClient } from "../src/api/client.js";
import { API_BASE, routes } from "../src/api/routes.js";

/**
 * An apiJson that records its calls.
 * @param {import("../src/app/context.js").JsonObject} [response]
 */
function createRecordingApiJson(response = { ok: true }) {
  /** @type {{ url: string, options?: any, timeoutMs?: number }[]} */
  const calls = [];
  /** @type {typeof import("../src/api/http.js").apiJson} */
  const apiJson = (url, options, timeoutMs) => {
    calls.push({ url, options, timeoutMs });
    return Promise.resolve(response);
  };
  return { apiJson, calls };
}

describe("loadPairedFromPath", () => {
  test("posts the file path as JSON", async () => {
    const { apiJson, calls } = createRecordingApiJson();
    const client = createApiClient({ apiJson });
    await client.loadPairedFromPath("/data/sub-01.edf");
    const call = calls[0];
    assert.equal(call.url, `${API_BASE}${routes.loadPairedFromPath}`);
    assert.equal(call.options.method, "POST");
    assert.equal(call.options.headers["Content-Type"], "application/json");
    assert.deepEqual(JSON.parse(call.options.body), {
      file_path: "/data/sub-01.edf",
    });
  });
});

describe("updateFilter", () => {
  test("posts the payload", async () => {
    const { apiJson, calls } = createRecordingApiJson();
    const client = createApiClient({ apiJson });
    const payload = { mu: 0, cutoff: 20 };
    await client.updateFilter(payload);
    const call = calls[0];
    assert.equal(call.url, `${API_BASE}${routes.editUpdateFilter}`);
    assert.equal(call.options.method, "POST");
    assert.deepEqual(JSON.parse(call.options.body), payload);
  });
});

describe("openFileDialog", () => {
  test("waits longer than the server keeps its dialog open", async () => {
    const { apiJson, calls } = createRecordingApiJson({ path: null });
    const client = createApiClient({ apiJson });
    await client.openFileDialog();
    const call = calls[0];
    assert.equal(call.url, `${API_BASE}${routes.dialogOpenFile}`);
    // The server gives up on the dialog after 120 s, then answers 408.
    assert.ok(/** @type {number} */ (call.timeoutMs) > 120000);
  });
});
