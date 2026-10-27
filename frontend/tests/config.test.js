// The page environment: the API origin and the canvas tokens.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { installDom, tokens } from "./_dom.js";

installDom();
const { API_BASE, COLORS, canvasFont } = await import("../src/config.js");

describe("API_BASE", () => {
  test("is the page's own origin", () => {
    assert.equal(API_BASE, "http://127.0.0.1:8000/api/v1");
  });
});

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
  test("is the page font at the small size", () => {
    assert.equal(
      canvasFont(),
      `${tokens.get("--fs-xs")} ${tokens.get("--font")}`,
    );
  });
});
