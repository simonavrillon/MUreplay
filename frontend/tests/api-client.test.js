// The API client: each call's route, method and body.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { createApiClient } from "../src/api/client.js";
import { API_BASE, routes } from "../src/api/routes.js";

/**
 * Records every apiJson call so tests can assert URL, method and body in one
 * place.
 * @param {import("../src/app/context.js").JsonObject} [response]
 */
function createRecordingApiJson(response = { ok: true }) {
  /** @type {{ url: string, options?: any }[]} */
  const calls = [];
  /** @type {typeof import("../src/api/http.js").apiJson} */
  const apiJson = (url, options) => {
    calls.push({ url, options });
    return Promise.resolve(response);
  };
  return { apiJson, calls };
}

describe("healthUrl", () => {
  test("composes the base with the health route", () => {
    const { apiJson } = createRecordingApiJson();
    const client = createApiClient({ apiJson });
    assert.equal(client.healthUrl(), `${API_BASE}${routes.health}`);
  });
});

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

describe("openFileDialog", () => {
  test("hits the dialog route", async () => {
    const { apiJson, calls } = createRecordingApiJson({ path: "/x.edf" });
    const client = createApiClient({ apiJson });
    await client.openFileDialog();
    assert.equal(calls[0].url, `${API_BASE}${routes.dialogOpenFile}`);
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
