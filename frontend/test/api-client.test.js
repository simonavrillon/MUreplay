import { test } from "node:test";
import assert from "node:assert/strict";
import { createApiClient } from "../src/api/client.js";
import { routes } from "../src/api/routes.js";

/**
 * Records every apiJson call so tests can assert URL, method, body and
 * timeout in one place.
 * @param {import("../src/app/context.js").JsonObject} [response]
 */
function createRecordingApiJson(response = { ok: true }) {
  /** @type {{ url: string, options?: any, timeoutMs?: number }[]} */
  const calls = [];
  /** @type {typeof import("../src/app/http.js").apiJson} */
  const apiJson = (url, options, timeoutMs) => {
    calls.push({ url, options, timeoutMs });
    return Promise.resolve(response);
  };
  return { apiJson, calls };
}

const API_BASE = "http://localhost:8000/api/v1";

test("healthUrl composes the base with the health route", () => {
  const { apiJson } = createRecordingApiJson();
  const client = createApiClient({ apiJson, API_BASE });
  assert.equal(client.healthUrl(), `${API_BASE}${routes.health}`);
});

test("fetchConfig issues a GET against the config route", async () => {
  const { apiJson, calls } = createRecordingApiJson({ data: { fsamp: 2048 } });
  const client = createApiClient({ apiJson, API_BASE });
  await client.fetchConfig();
  assert.equal(calls[0].url, `${API_BASE}${routes.config}`);
  assert.equal(calls[0].options, undefined);
});

test("loadPairedFromPath posts the file path as JSON", async () => {
  const { apiJson, calls } = createRecordingApiJson();
  const client = createApiClient({ apiJson, API_BASE });
  await client.loadPairedFromPath("/data/sub-01.edf");
  const call = calls[0];
  assert.equal(call.url, `${API_BASE}${routes.loadPairedFromPath}`);
  assert.equal(call.options.method, "POST");
  assert.equal(call.options.headers["Content-Type"], "application/json");
  assert.deepEqual(JSON.parse(call.options.body), {
    file_path: "/data/sub-01.edf",
  });
});

test("openFileDialog hits the dialog route", async () => {
  const { apiJson, calls } = createRecordingApiJson({ path: "/x.edf" });
  const client = createApiClient({ apiJson, API_BASE });
  await client.openFileDialog();
  assert.equal(calls[0].url, `${API_BASE}${routes.dialogOpenFile}`);
});

test("updateFilter posts the payload with a raised timeout", async () => {
  const { apiJson, calls } = createRecordingApiJson();
  const client = createApiClient({ apiJson, API_BASE });
  const payload = { mu_idx: 0, cutoff: 20 };
  await client.updateFilter(payload);
  const call = calls[0];
  assert.equal(call.url, `${API_BASE}${routes.editUpdateFilter}`);
  assert.equal(call.options.method, "POST");
  assert.deepEqual(JSON.parse(call.options.body), payload);
  assert.equal(call.timeoutMs, 120000);
});
