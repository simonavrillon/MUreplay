// The state setters whose effect is more than one assignment.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  restoreReplayBase,
  setMuRows,
  setPlayTimer,
  setReplayBase,
} from "../src/state/actions.js";

/** @returns {import("../src/state/state.js").State} */
function emptyState() {
  return /** @type {any} */ ({
    distimes: [],
    pulseTrains: [],
    artifactTimes: [],
    replayBaseDistimes: [],
    replayBasePulseTrains: [],
    replayBaseArtifactTimes: [],
    replayBackups: [],
    replayPosition: 0,
    replayView: null,
    isPlaying: false,
    playTimer: null,
  });
}

describe("setReplayBase", () => {
  test("keeps a copy as the base and shows another at step 0", () => {
    const state = emptyState();
    state.replayPosition = 3;
    state.replayView = { start: 1, end: 2 };
    const base = {
      distimes: [[1, 2]],
      pulseTrains: [[0, 1]],
      artifactTimes: [[7]],
    };
    setReplayBase(state, base);

    assert.deepEqual(state.distimes, [[1, 2]]);
    assert.equal(state.replayPosition, 0);
    assert.equal(state.replayView, null);
    // Neither copy aliases the base or the other.
    state.distimes[0].push(9);
    assert.deepEqual(state.replayBaseDistimes, [[1, 2]]);
    assert.deepEqual(base.distimes, [[1, 2]]);
  });
});

describe("restoreReplayBase", () => {
  test("drops the edits and backups made since step 0", () => {
    const state = emptyState();
    setReplayBase(state, {
      distimes: [[1]],
      pulseTrains: [[0]],
      artifactTimes: [],
    });
    setMuRows(state, 0, { distimes: [1, 5] });
    state.replayBackups.push(/** @type {any} */ ({ stepIdx: 0 }));
    state.replayPosition = 1;

    restoreReplayBase(state);
    assert.deepEqual(state.distimes, [[1]]);
    assert.deepEqual(state.replayBackups, []);
    assert.equal(state.replayPosition, 0);
  });
});

describe("setMuRows", () => {
  test("replaces only the rows it is given", () => {
    const state = emptyState();
    state.distimes = [[1]];
    state.pulseTrains = [[0, 1]];
    setMuRows(state, 0, { distimes: [2] });
    assert.deepEqual(state.distimes, [[2]]);
    assert.deepEqual(state.pulseTrains, [[0, 1]]);
  });
});

describe("setPlayTimer", () => {
  test("plays while a timer is set, including timer id 0", () => {
    const state = emptyState();
    setPlayTimer(state, 0);
    assert.equal(state.isPlaying, true);
    setPlayTimer(state, null);
    assert.equal(state.isPlaying, false);
  });
});
