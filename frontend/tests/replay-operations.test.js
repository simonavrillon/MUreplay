// The helpers the timeline relies on: clamping, and the diff summary.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  clamp,
  diffSquares,
  dischargeDiff,
  shiftViewInside,
} from "../src/replay/operations.js";

describe("clamp", () => {
  test("constrains a value to the range", () => {
    assert.equal(clamp(-1, 0, 10), 0);
    assert.equal(clamp(11, 0, 10), 10);
  });
});

describe("shiftViewInside", () => {
  test("shifts a view back inside the recording, keeping its width", () => {
    assert.deepEqual(shiftViewInside(-20, 80, 1000), { start: 0, end: 100 });
    assert.deepEqual(shiftViewInside(950, 1050, 1000), {
      start: 900,
      end: 1000,
    });
  });

  test("trims a view wider than the recording to the whole of it", () => {
    assert.deepEqual(shiftViewInside(-50, 1500, 1000), { start: 0, end: 1000 });
  });
});

describe("dischargeDiff", () => {
  test("counts the discharges the steps on one MU added and removed", () => {
    const steps = [
      { mu: 0, spikesAdded: [1, 2], spikesRemoved: [3] },
      { mu: 1, spikesAdded: [4], spikesRemoved: [] },
      { mu: 0, spikesAdded: [], spikesRemoved: [5, 6] },
    ];
    assert.deepEqual(dischargeDiff(steps, 0), { added: 2, removed: 3 });
  });
});

describe("diffSquares", () => {
  test("splits five squares between added and removed, as GitHub does", () => {
    // 3 of 4 changes added: 3.75 of the five squares, rounded to 4.
    assert.deepEqual(diffSquares(3, 1), [
      "added",
      "added",
      "added",
      "added",
      "removed",
    ]);
    assert.deepEqual(diffSquares(0, 4), Array(5).fill("removed"));
  });

  test("no change is five neutral squares", () => {
    assert.deepEqual(diffSquares(0, 0), Array(5).fill("neutral"));
  });
});
