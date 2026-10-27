import { test, after } from "node:test";
import assert from "node:assert/strict";

const originalWindow = globalThis.window;
after(() => {
  globalThis.window = originalWindow;
});

/**
 * config.js reads `window` at module scope and the module registry caches
 * evaluations, so each branch needs a distinct module instance. Importing
 * with a unique query string gives every load a fresh evaluation while
 * keeping a single file under test.
 *
 * @param {{
 *   MUREPLAY_API_BASE?: string,
 *   port?: string,
 *   protocol?: string,
 *   hostname?: string,
 *   origin?: string,
 * }} windowSpec
 */
async function loadConfig(windowSpec) {
  globalThis.window = /** @type {any} */ ({
    MUREPLAY_API_BASE: windowSpec.MUREPLAY_API_BASE,
    location: {
      port: windowSpec.port ?? "",
      protocol: windowSpec.protocol ?? "http:",
      hostname: windowSpec.hostname ?? "localhost",
      origin: windowSpec.origin ?? "http://localhost",
    },
  });
  const mod = await import(
    `../src/config.js?case=${encodeURIComponent(JSON.stringify(windowSpec))}`
  );
  return mod;
}

test("API_BASE honors the MUREPLAY_API_BASE window override", async () => {
  const { API_BASE } = await loadConfig({
    MUREPLAY_API_BASE: "http://example.org/custom/api",
  });
  assert.equal(API_BASE, "http://example.org/custom/api");
});

test("API_BASE targets the API port in web dev mode (:8080)", async () => {
  const { API_BASE } = await loadConfig({
    port: "8080",
    protocol: "https:",
    hostname: "dev.host",
  });
  assert.equal(API_BASE, "https://dev.host:8000/api/v1");
});

test("API_BASE shares the origin in desktop mode", async () => {
  const { API_BASE } = await loadConfig({
    port: "8000",
    origin: "http://127.0.0.1:8000",
  });
  assert.equal(API_BASE, "http://127.0.0.1:8000/api/v1");
});

test("COLORS and GRID_COLORS expose the palette constants", async () => {
  const { COLORS, GRID_COLORS, UNIFORM_PULSE_COLOR } = await loadConfig({});
  assert.equal(COLORS.secondary, "#ffd43b");
  assert.equal(COLORS.artifactMarker, "#ff8c66");
  assert.ok(GRID_COLORS.length > 1);
  assert.equal(UNIFORM_PULSE_COLOR, GRID_COLORS[1]);
});
