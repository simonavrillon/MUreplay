// The status lines.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { createUiService } from "../src/app/services/ui.js";
import { fakeElement } from "./_dom.js";

/**
 * Partial on purpose: the ui service reads `app.els` and nothing else.
 * @param {{ status?: any, replayStatus?: any }} [els]
 */
function createApp(els = {}) {
  return /** @type {import("../src/app/context.js").App} */ (
    /** @type {unknown} */ ({
      els: { status: fakeElement(), replayStatus: fakeElement(), ...els },
    })
  );
}

describe("setStatus", () => {
  test("writes text and hides the line while it is empty", () => {
    const status = fakeElement();
    const ui = createUiService(createApp({ status }));
    ui.setStatus("Loading…");
    assert.equal(status.textContent, "Loading…");
    assert.equal(status.hidden, false);
    ui.setStatus("");
    assert.equal(status.textContent, "");
    assert.equal(status.hidden, true);
  });

  test("sets the tone the stylesheet colours by, muted by default", () => {
    const status = fakeElement();
    const ui = createUiService(createApp({ status }));
    ui.setStatus("Backend unreachable", "error");
    assert.equal(status.dataset.tone, "error");
    ui.setStatus("Connecting");
    assert.equal(status.dataset.tone, "muted");
  });
});

describe("setReplayStatus", () => {
  test("writes text in the tone the stylesheet colours by, muted by default", () => {
    const replayStatus = fakeElement();
    const ui = createUiService(createApp({ replayStatus }));
    ui.setReplayStatus("Could not load the session: not found", "error");
    assert.equal(
      replayStatus.textContent,
      "Could not load the session: not found",
    );
    assert.equal(replayStatus.dataset.tone, "error");
    ui.setReplayStatus("Loaded 3 MUs");
    assert.equal(replayStatus.dataset.tone, "muted");
  });
});
