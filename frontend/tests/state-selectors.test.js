// Derived reads of the state: grids and their MUs, the step at the playhead, the current MU's rows.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  artifactTimesForCurrentMu,
  currentStep,
  spikesForCurrentMu,
  firstGridWithMu,
  getReplayView,
  isCurrentMuStep,
  musForGrid,
  pulseForCurrentMu,
  resolveStepMuIndex,
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
    muUids: [],
    spikeTimes: [],
    pulseTrains: [],
    artifactTimes: [],
    filteredReplayGroups: [],
    replayPosition: 0,
    replayView: null,
    currentMu: 0,
    ...fields,
  });
}

/** @param {Record<string, any>} fields */
const entry = (fields) =>
  /** @type {any} */ ({ muIdx: -1, muUid: "", ...fields });

describe("musForGrid and firstGridWithMu", () => {
  test("read the grid assignment", () => {
    const state = stateWith({ muGridIndex: [2, 0, 2] });
    assert.deepEqual(musForGrid(state, 2), [0, 2]);
    assert.deepEqual(musForGrid(state, 0), [1]);
    assert.deepEqual(musForGrid(state, 1), []);
    // The grid of the first MU, not the lowest grid number.
    assert.equal(firstGridWithMu(state), 2);
    assert.equal(firstGridWithMu(stateWith({})), 0);
  });
});

describe("resolveStepMuIndex", () => {
  test("prefers the logged index, then the uid, else -1", () => {
    const state = stateWith({ muUids: ["g0_mu0", "g0_mu1"] });
    assert.equal(
      resolveStepMuIndex(state, entry({ muIdx: 0, muUid: "g0_mu1" })),
      0,
    );
    assert.equal(resolveStepMuIndex(state, entry({ muUid: "g0_mu1" })), 1);
    assert.equal(resolveStepMuIndex(state, entry({ muUid: "g9_mu9" })), -1);
    assert.equal(resolveStepMuIndex(state, null), -1);
  });
});

describe("currentStep", () => {
  test("reports the group behind the playhead", () => {
    const first = entry({ muIdx: 0 });
    const second = entry({ muIdx: 1 });
    const groups = [first, second].map((displayStep, i) => ({
      indices: [i],
      type: "spike_edits",
      displayStep,
    }));
    const state = stateWith({ filteredReplayGroups: groups });

    assert.equal(currentStep(state), null, "no step applied yet");
    state.replayPosition = 1;
    assert.equal(currentStep(state), first);
    assert.equal(isCurrentMuStep(state, first), true);
    assert.equal(isCurrentMuStep(state, second), false);
    assert.equal(isCurrentMuStep(state, null), false);
  });
});

describe("pulseForCurrentMu", () => {
  test("synthesizes a train when none was loaded", () => {
    const state = stateWith({ spikeTimes: [[2, 5]], pulseTrains: [[]] });
    assert.deepEqual(pulseForCurrentMu(state), [0, 0, 1, 0, 0, 1]);
    assert.deepEqual(spikesForCurrentMu(state), [2, 5]);
    assert.deepEqual(artifactTimesForCurrentMu(state), []);
  });
});

describe("getReplayView", () => {
  test("is the whole recording until a view is set", () => {
    assert.deepEqual(getReplayView(stateWith({}), 100), { start: 0, end: 100 });
    const zoomed = stateWith({ replayView: { start: 10, end: 20 } });
    assert.deepEqual(getReplayView(zoomed, 100), { start: 10, end: 20 });
  });
});
