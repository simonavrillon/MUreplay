// Sample series: the range a plot scales to.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { seriesRange } from "../src/signal/series.js";

describe("seriesRange", () => {
  test("finds min and max of a full array", () => {
    assert.deepEqual(seriesRange([3, -2, 7, 0]), { min: -2, max: 7 });
    assert.deepEqual(seriesRange([4]), { min: 4, max: 4 });
  });

  test("honors the start/end range", () => {
    const values = [9, 1, 5, 3, 7];
    assert.deepEqual(seriesRange(values, 1, 4), { min: 1, max: 5 });
    assert.deepEqual(seriesRange(values, 3, 5), { min: 3, max: 7 });
  });
});
