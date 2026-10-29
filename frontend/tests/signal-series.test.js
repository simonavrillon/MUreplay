// Viewport series: the range a plot scales to.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { traceRange } from "../src/signal/series.js";

describe("traceRange", () => {
  test("spans the samples of a window", () => {
    const trace = { row: Float32Array.from([3, -2, 7]), start: 1, end: 4 };
    assert.deepEqual(traceRange(trace), { min: -2, max: 7 });
  });

  test("spans every bin's min and max of an envelope", () => {
    const row = {
      min: Float32Array.from([-3, 0]),
      max: Float32Array.from([5, 8]),
    };
    assert.deepEqual(traceRange({ row, start: 0, end: 6 }), {
      min: -3,
      max: 8,
    });
  });

  test("a window without samples has the range 0 to 0", () => {
    assert.deepEqual(traceRange({ row: null, start: 0, end: 0 }), {
      min: 0,
      max: 0,
    });
  });
});
