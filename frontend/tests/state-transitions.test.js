// Opening a session: what a new file replaces in the state.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { beginSession } from "../src/state/transitions.js";

describe("beginSession", () => {
  test("replaces the token, the decomposition and the previous session's log", () => {
    const state = /** @type {any} */ ({ editHistory: [{}], pulseView: {} });
    const editHistory = /** @type {any[]} */ ([]);
    const spikeTimes = [Int32Array.from([1])];
    beginSession(state, {
      token: "t2",
      sourceFilename: "b_edited.npz",
      bidsRoot: "/b",
      entityLabel: "b",
      fsamp: 2000,
      totalSamples: 10,
      spikeTimes,
      versions: [1],
      gridNames: ["G"],
      muGridIndex: [0],
      muUids: ["g0_mu0"],
      artifactRegions: [],
      // Shown in the settings panel only; the state does not keep them.
      parameters: /** @type {any} */ ({}),
      sidecarMeta: /** @type {any} */ ({}),
      editHistory,
    });
    assert.equal(state.token, "t2");
    assert.equal(state.spikeTimes, spikeTimes);
    assert.equal(state.editHistory, editHistory);
    // The previous session's window is not this one's.
    assert.equal(state.pulseView, null);
  });
});
