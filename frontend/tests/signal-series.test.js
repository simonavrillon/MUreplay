// Sample series: the range a plot scales to.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { extent } from "../src/signal/series.js";

describe("extent", () => {
  test("finds min and max of a full array", () => {
    assert.deepEqual(extent([3, -2, 7, 0]), { min: -2, max: 7 });
    assert.deepEqual(extent([4]), { min: 4, max: 4 });
  });

  test("honors the start/end range and clamps it", () => {
    const values = [9, 1, 5, 3, 7];
    assert.deepEqual(extent(values, 1, 4), { min: 1, max: 5 });
    assert.deepEqual(extent(values, -10, 2), { min: 1, max: 9 });
    assert.deepEqual(extent(values, 3, 100), { min: 3, max: 7 });
  });

  test("reports a flat zero line for an empty range", () => {
    assert.deepEqual(extent([]), { min: 0, max: 0 });
    assert.deepEqual(extent([1, 2], 2, 5), { min: 0, max: 0 });
    assert.deepEqual(extent([1, 2], 1, 0), { min: 0, max: 0 });
  });
});
