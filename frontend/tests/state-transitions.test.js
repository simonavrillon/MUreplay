// Opening a session: what a new file replaces in the state.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { beginSession } from "../src/state/transitions.js";

describe("beginSession", () => {
  test("replaces the file and the previous session's log", () => {
    const state = /** @type {any} */ ({ editHistory: [{}] });
    const editHistory = /** @type {any[]} */ ([]);
    beginSession(state, {
      sourceFilename: "b_edited.npz",
      bidsRoot: "/b",
      entityLabel: "b",
      fsamp: 2000,
      pulseTrains: [[0]],
      spikeTimes: [[1]],
      gridNames: ["G"],
      muGridIndex: [0],
      muUids: ["g0_mu0"],
      artifactTimes: [],
      artifactRegions: [],
      refitSettings: {
        nbextchan: 1000,
        peelOffWin: 0.025,
        computeDtype: "float32",
      },
      // Shown in the settings panel only; the state does not keep them.
      parameters: /** @type {any} */ ({}),
      sidecarMeta: /** @type {any} */ ({}),
      editHistory,
    });
    assert.equal(state.bidsRoot, "/b");
    assert.deepEqual(state.spikeTimes, [[1]]);
    assert.equal(state.editHistory, editHistory);
    // A plain file name: not the decomposition the edits started from.
    assert.equal(state.loadedFromDecomp, false);
  });
});
