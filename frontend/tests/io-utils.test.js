// Small shared helpers: MU uids, entity labels, clamping, basenames and extents.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  basename,
  buildMuUids,
  clamp,
  extent,
  inferEntityLabel,
} from "../src/io/utils.js";

describe("buildMuUids", () => {
  test("numbers MUs per grid", () => {
    assert.deepEqual(buildMuUids([0, 0, 1]), ["g0_mu0", "g0_mu1", "g1_mu0"]);
    assert.deepEqual(buildMuUids([]), []);
    // Non-numeric entries fall back to grid 0.
    assert.deepEqual(buildMuUids([null, undefined]), ["g0_mu0", "g0_mu1"]);
  });

  test("counts independently per grid index", () => {
    const uids = buildMuUids([2, 0, 2, 2, 0]);
    assert.deepEqual(uids, ["g2_mu0", "g0_mu0", "g2_mu1", "g2_mu2", "g0_mu1"]);
  });
});

describe("inferEntityLabel", () => {
  test("strips extension and edit/decomp suffixes", () => {
    assert.equal(inferEntityLabel("sub-01_edited.json"), "sub-01");
    assert.equal(inferEntityLabel("sub-01_decomp.json"), "sub-01");
    assert.equal(inferEntityLabel("sub-01_DECOMP.json"), "sub-01");
    assert.equal(inferEntityLabel("session.rec"), "session");
    assert.equal(inferEntityLabel(""), "");
    assert.equal(inferEntityLabel(null), "");
    // Extension stripping runs before suffix stripping, so "_decomp" inside a
    // (multi-dot) extension is removed as part of that extension.
    assert.equal(inferEntityLabel("a.b_decomp"), "a");
  });
});

describe("clamp", () => {
  test("constrains a value to the range", () => {
    assert.equal(clamp(5, 0, 10), 5);
    assert.equal(clamp(-1, 0, 10), 0);
    assert.equal(clamp(11, 0, 10), 10);
    assert.equal(clamp(0, 0, 10), 0);
    assert.equal(clamp(10, 0, 10), 10);
  });

  test("collapses to the low bound when the bounds are reversed", () => {
    // Not a supported call, but worth pinning: `max(lo, min(hi, v))` returns
    // `lo` for every input once lo > hi, so reversed bounds do not silently
    // behave like the range read the other way round.
    assert.equal(clamp(11, 10, 0), 10);
    assert.equal(clamp(-1, 10, 0), 10);
    assert.equal(clamp(5, 10, 0), 10);
  });
});

describe("basename", () => {
  test("takes the last segment for either separator", () => {
    assert.equal(
      basename("/recordings/sub-01_edited.json"),
      "sub-01_edited.json",
    );
    assert.equal(
      basename("C:\\data\\sub-01_edited.json"),
      "sub-01_edited.json",
    );
    // A UNC path and a mixed-separator path both reduce to the filename.
    assert.equal(basename("\\\\server\\share\\rec.json"), "rec.json");
    assert.equal(basename("C:\\data/nested\\rec.json"), "rec.json");
    assert.equal(basename("rec.json"), "rec.json");
    assert.equal(basename(""), "");
    assert.equal(basename(null), "");
    // A trailing separator has no segment after it.
    assert.equal(basename("/recordings/"), "");
  });
});

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
