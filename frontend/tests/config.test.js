// The canvas tokens.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { installDom, tokens } from "./_dom.js";

installDom();
const { COLORS, canvasFont } = await import("../src/config.js");

describe("COLORS", () => {
  test("resolves every colour to its token in tokens.css", () => {
    for (const [key, value] of Object.entries(COLORS)) {
      assert.ok(
        value,
        `COLORS.${key} names a token tokens.css does not define`,
      );
    }
    assert.equal(COLORS.artifactMarker, tokens.get("--artifact"));
  });
});

describe("canvasFont", () => {
  test("is the page font at the small size, in pixels", () => {
    // 0.75rem at the browser's default 16 px root.
    assert.equal(canvasFont(), `12px ${tokens.get("--font")}`);
  });
});
