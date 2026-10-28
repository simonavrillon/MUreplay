// The replay status line.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { createUiService } from "../src/app/services/ui.js";
import { fakeElement } from "./_dom.js";

/**
 * Partial on purpose: the ui service reads `app.els` and nothing else.
 * @param {{ replayStatus?: any }} [els]
 */
function createApp(els = {}) {
  return /** @type {import("../src/app/context.js").App} */ (
    /** @type {unknown} */ ({
      els: { replayStatus: fakeElement(), ...els },
    })
  );
}

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
