// The API client: each call's route, method, body, timeout and decoding.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { createApiClient } from "../src/api/client.js";
import { API_BASE, routes } from "../src/api/routes.js";
import { encodeFrame } from "./_frames.js";

/**
 * An apiJson and an apiFetch that record their calls; apiFetch answers with `frame`.
 * @param {{ json?: import("../src/app/context.js").JsonObject, frame?: ArrayBuffer }} [answers]
 */
function createRecordingApi({
  json = { ok: true },
  frame = encodeFrame({}, {}),
} = {}) {
  /** @type {{ url: string, options?: any, timeoutMs?: number }[]} */
  const calls = [];
  /** @type {typeof import("../src/api/http.js").apiJson} */
  const apiJson = (url, options, timeoutMs) => {
    calls.push({ url, options, timeoutMs });
    return Promise.resolve(json);
  };
  /** @type {typeof import("../src/api/http.js").apiFetch} */
  const apiFetch = (url, options, timeoutMs) => {
    calls.push({ url, options, timeoutMs });
    return Promise.resolve(
      /** @type {any} */ ({ arrayBuffer: async () => frame }),
    );
  };
  return {
    client: createApiClient({ apiJson, apiFetch, sessionId: "tab-1" }),
    calls,
  };
}

describe("replayOpen", () => {
  test("posts the file path and decodes the session's discharges", async () => {
    const frame = encodeFrame(
      { token: "t" },
      {
        spikes: { dtype: "i4", shape: [3], data: [100, 300, 7] },
        spike_offsets: { dtype: "i8", shape: [3], data: [0, 2, 3] },
      },
    );
    const { client, calls } = createRecordingApi({ frame });
    const session = await client.replayOpen("/data/sub-01_edited.json");
    const call = calls[0];
    assert.equal(call.url, `${API_BASE}${routes.replaySessionOpen}`);
    assert.equal(call.options.method, "POST");
    assert.deepEqual(JSON.parse(call.options.body), {
      file_path: "/data/sub-01_edited.json",
    });
    assert.equal(session.meta.token, "t");
    assert.deepEqual(
      session.spikeTimes.map((row) => [...row]),
      [[100, 300], [7]],
    );
  });
});

describe("replaySeek", () => {
  test("posts the steps, and waits as long as a grid takes to filter", async () => {
    const { client, calls } = createRecordingApi();
    await client.replaySeek({ token: "t", steps: [0, 2] });
    const call = calls[0];
    assert.equal(call.url, `${API_BASE}${routes.replaySeek}`);
    assert.deepEqual(JSON.parse(call.options.body), {
      token: "t",
      steps: [0, 2],
    });
    assert.ok(/** @type {number} */ (call.timeoutMs) > 120000);
  });
});

describe("fetchPulse", () => {
  test("asks for the window in the query and decodes the frame", async () => {
    const frame = encodeFrame(
      { mu: 1, start: 0, end: 4, bins: 4, version: 7, kind: "samples" },
      {
        samples: { dtype: "f4", shape: [1, 4], rows: [[0, 1, 2, 3]] },
        spikes: { dtype: "i4", shape: [1], data: [2] },
        spike_values: { dtype: "f4", shape: [1], data: [2] },
      },
    );
    const { client, calls } = createRecordingApi({ frame });
    const view = await client.fetchPulse({
      token: "t",
      mu: 1,
      start: 0,
      end: 4,
      bins: 4,
    });
    assert.equal(
      calls[0].url,
      `${API_BASE}${routes.seriesPulse}?token=t&mu=1&start=0&end=4&bins=4`,
    );
    assert.equal(view.version, 7);
    assert.deepEqual([.../** @type {Float32Array} */ (view.row)], [0, 1, 2, 3]);
    assert.deepEqual([...view.spikes], [2]);
    assert.deepEqual([...view.artifacts], []);
  });
});

describe("closeSession", () => {
  test("names the tab in the query and outlives the page", () => {
    const { client, calls } = createRecordingApi();
    client.closeSession();
    assert.equal(
      calls[0].url,
      `${API_BASE}${routes.sessionClose}?session=tab-1`,
    );
    assert.equal(calls[0].options.keepalive, true);
  });
});

describe("chooseDataFolder", () => {
  test("posts, and waits longer than the server keeps its dialog open", async () => {
    const { client, calls } = createRecordingApi({ json: { data_root: null } });
    await client.chooseDataFolder();
    const call = calls[0];
    assert.equal(call.url, `${API_BASE}${routes.dialogDataFolder}`);
    assert.equal(call.options.method, "POST");
    // The server gives up on the dialog after 120 s, then answers 408.
    assert.ok(/** @type {number} */ (call.timeoutMs) > 120000);
  });
});
