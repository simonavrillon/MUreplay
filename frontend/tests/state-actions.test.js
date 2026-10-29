// The state setters whose effect is more than one assignment.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  applyReplayChange,
  resetReplayPosition,
} from "../src/state/actions.js";

describe("applyReplayChange", () => {
  test("replaces only the changed MUs' discharges, and every version", () => {
    const state = /** @type {any} */ ({
      spikeTimes: [Int32Array.from([1]), Int32Array.from([2])],
      versions: [1, 2],
    });
    applyReplayChange(state, {
      changed: [1],
      spikeTimes: [Int32Array.from([2, 9])],
      versions: [1, 3],
      refitErrors: [],
    });
    assert.deepEqual([...state.spikeTimes[0]], [1]);
    assert.deepEqual([...state.spikeTimes[1]], [2, 9]);
    assert.deepEqual(state.versions, [1, 3]);
  });
});

describe("resetReplayPosition", () => {
  test("goes back to step 0 with the whole recording in view", () => {
    const state = /** @type {any} */ ({
      replayPosition: 3,
      replayView: { start: 1, end: 2 },
    });
    resetReplayPosition(state);
    assert.equal(state.replayPosition, 0);
    assert.equal(state.replayView, null);
  });
});
