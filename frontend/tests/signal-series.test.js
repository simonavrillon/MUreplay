// Viewport series: their range, and a window binned to the plot's width.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { traceRange, traceWindow } from "../src/signal/series.js";

describe("traceWindow", () => {
  test("keeps every sample when the plot has a pixel for each", () => {
    const trace = traceWindow([9, 3, -2, 7, 0], { start: 1, end: 4 }, 10);
    assert.deepEqual([.../** @type {any} */ (trace.row)], [3, -2, 7]);
    assert.deepEqual(traceRange(trace), { min: -2, max: 7 });
  });

  test("bins more samples than pixels into each bin's min and max", () => {
    const trace = traceWindow([1, 5, -3, 2, 8, 0], { start: 0, end: 6 }, 2);
    const row = /** @type {any} */ (trace.row);
    assert.deepEqual([...row.min], [-3, 0]);
    assert.deepEqual([...row.max], [5, 8]);
    assert.deepEqual(traceRange(trace), { min: -3, max: 8 });
  });

  test("a window without samples has the range 0 to 0", () => {
    assert.deepEqual(traceRange({ row: null, start: 0, end: 0 }), {
      min: 0,
      max: 0,
    });
  });
});
