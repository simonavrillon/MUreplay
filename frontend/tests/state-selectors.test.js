// Derived reads of the state: grids and their MUs, the step at the playhead, the current MU's rows.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  currentMuStep,
  currentStep,
  clampedReplayView,
  musForGrid,
  pulseViewForCurrentMu,
  spikesForCurrentMu,
} from "../src/state/selectors.js";

/**
 * Only the fields a selector reads; the rest of the state is irrelevant to it.
 *
 * @param {Record<string, any>} fields
 * @returns {import("../src/state/state.js").State}
 */
function stateWith(fields) {
  return /** @type {any} */ ({
    muGridIndex: [],
    spikeTimes: [],
    pulseView: null,
    timelineGroups: [],
    replayPosition: 0,
    replayView: null,
    currentMu: 0,
    ...fields,
  });
}

/** @param {Record<string, any>} fields */
const entry = (fields) => /** @type {any} */ ({ mu: -1, muUid: "", ...fields });

describe("musForGrid", () => {
  test("lists the MUs on a grid, in file order", () => {
    const state = stateWith({ muGridIndex: [2, 0, 2] });
    assert.deepEqual(musForGrid(state, 2), [0, 2]);
    assert.deepEqual(musForGrid(state, 0), [1]);
    assert.deepEqual(musForGrid(state, 1), []);
  });
});

describe("currentStep and currentMuStep", () => {
  test("reports the group behind the playhead", () => {
    const first = entry({ mu: 0 });
    const second = entry({ mu: 1 });
    const groups = [first, second].map((displayStep, i) => ({
      indices: [i],
      type: "spike_edits",
      displayStep,
    }));
    const state = stateWith({ timelineGroups: groups });

    assert.equal(currentStep(state), null, "no step applied yet");
    assert.equal(currentMuStep(state), null);
    state.replayPosition = 1;
    assert.equal(currentStep(state), first);
    assert.equal(currentMuStep(state), first);
    state.replayPosition = 2;
    assert.equal(currentStep(state), second);
    assert.equal(currentMuStep(state), null, "the step is on another MU");
  });
});

describe("the current MU's rows", () => {
  test("are its own, or empty when no MU is loaded", () => {
    const state = stateWith({ spikeTimes: [Int32Array.from([2, 5])] });
    assert.deepEqual([...spikesForCurrentMu(state)], [2, 5]);
    assert.deepEqual([...spikesForCurrentMu(stateWith({}))], []);
  });

  test("the pulse window shown is the current MU's, or none", () => {
    const view = /** @type {any} */ ({ mu: 1 });
    assert.equal(
      pulseViewForCurrentMu(stateWith({ pulseView: view, currentMu: 1 })),
      view,
    );
    assert.equal(pulseViewForCurrentMu(stateWith({ pulseView: view })), null);
  });
});

describe("clampedReplayView", () => {
  test("is the whole recording until a view is set", () => {
    assert.deepEqual(clampedReplayView(stateWith({}), 100), {
      start: 0,
      end: 100,
    });
    const zoomed = stateWith({ replayView: { start: 10, end: 20 } });
    assert.deepEqual(clampedReplayView(zoomed, 100), { start: 10, end: 20 });
  });

  test("keeps the view inside the recording", () => {
    const wide = stateWith({ replayView: { start: 80, end: 500 } });
    assert.deepEqual(clampedReplayView(wide, 100), { start: 80, end: 100 });
  });
});
