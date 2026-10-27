import { test, after } from "node:test";
import assert from "node:assert/strict";

const saved = {
  window: globalThis.window,
  document: globalThis.document,
  getComputedStyle: globalThis.getComputedStyle,
};
after(() => Object.assign(globalThis, saved));

/** @type {Record<string, string>} */
const tokens = {
  "--text": "#ffffff",
  "--artifact": "#ff8c66",
  "--fs-xs": "10px",
  "--font": "Plex",
};

globalThis.window = /** @type {any} */ ({
  location: { origin: "http://127.0.0.1:8000" },
});
globalThis.document = /** @type {any} */ ({ documentElement: {} });
globalThis.getComputedStyle = /** @type {any} */ (
  () => ({
    getPropertyValue: (/** @type {string} */ name) => tokens[name] ?? "",
  })
);
const { API_BASE, COLORS, canvasFont } = await import("../src/config.js");

test("API_BASE is the page's own origin", () => {
  assert.equal(API_BASE, "http://127.0.0.1:8000/api/v1");
});

test("COLORS reads each canvas colour from its CSS token", () => {
  assert.equal(COLORS.primary, "#ffffff");
  assert.equal(COLORS.artifactMarker, "#ff8c66");
});

test("canvasFont is the page font at the small size", () => {
  assert.equal(canvasFont(), "10px Plex");
});
