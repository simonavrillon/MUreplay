// BIDS file names: basenames and the entity label a file is named after.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { basename, entityLabelFromFilename } from "../src/io/bids.js";

describe("entityLabelFromFilename", () => {
  test("strips extension and edit/decomp suffixes", () => {
    assert.equal(entityLabelFromFilename("sub-01_edited.json"), "sub-01");
    assert.equal(entityLabelFromFilename("sub-01_decomp.json"), "sub-01");
    assert.equal(entityLabelFromFilename("sub-01_DECOMP.json"), "sub-01");
    assert.equal(entityLabelFromFilename("session.rec"), "session");
    assert.equal(entityLabelFromFilename(""), "");
    assert.equal(entityLabelFromFilename(null), "");
    // Extension stripping runs before suffix stripping, so "_decomp" inside a
    // (multi-dot) extension is removed as part of that extension.
    assert.equal(entityLabelFromFilename("a.b_decomp"), "a");
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
