// Opening a session: what a new file replaces in the state.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { beginSession } from "../src/state/transitions.js";

describe("beginSession", () => {
  test("replaces the file and keeps nothing of the previous session's log", () => {
    const state = /** @type {any} */ ({
      history: [{}],
      replayGroups: [{}],
      filteredReplayGroups: [{}],
      muMarks: { g0_mu0: "flagged" },
      muGhostUids: ["g0_mu9"],
    });
    beginSession(
      state,
      {
        filename: "b_edited.npz",
        bidsRoot: "/b",
        entityLabel: "b",
      },
      {
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
      },
    );
    assert.equal(state.bidsRoot, "/b");
    assert.deepEqual(state.spikeTimes, [[1]]);
    // A plain file name: not the decomposition the edits started from.
    assert.equal(state.loadedFromDecomp, false);
    for (const key of [
      "history",
      "replayGroups",
      "filteredReplayGroups",
      "muGhostUids",
    ]) {
      assert.deepEqual(state[key], [], key);
    }
    assert.deepEqual(state.muMarks, {});
  });
});
