// The status lines.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { createUiService } from "../src/app/services/ui.js";
import { fakeElement } from "./_dom.js";

/**
 * Partial on purpose: the ui service reads `app.els` and nothing else.
 * @param {{ status?: any, editStatus?: any }} [els]
 */
function createApp(els = {}) {
  return /** @type {import("../src/app/context.js").App} */ (
    /** @type {unknown} */ ({ els: { status: null, editStatus: null, ...els } })
  );
}

describe("setStatus", () => {
  test("writes text and toggles the hidden class", () => {
    const status = fakeElement();
    const ui = createUiService(createApp({ status }));
    ui.setStatus("Loading...");
    assert.equal(status.textContent, "Loading...");
    assert.equal(status.classList.has("hidden"), false);
    ui.setStatus("");
    assert.equal(status.textContent, "");
    assert.equal(status.classList.has("hidden"), true);
  });

  test("applies a tone and clears the previous one", () => {
    const status = fakeElement();
    status.classList.add("muted");
    const ui = createUiService(createApp({ status }));
    ui.setStatus("Saved", "success");
    assert.equal(status.classList.has("success"), true);
    assert.equal(status.classList.has("muted"), false);
    assert.equal(status.classList.has("error"), false);
    // A call without a tone keeps the current tone classes untouched.
    ui.setStatus("Saved again");
    assert.equal(status.classList.has("success"), true);
  });

  test("tolerates a missing status element", () => {
    const ui = createUiService(createApp());
    assert.doesNotThrow(() => ui.setStatus("anything", "error"));
  });
});

describe("setEditStatus", () => {
  test("writes text and tolerates a missing element", () => {
    const editStatus = fakeElement();
    const ui = createUiService(createApp({ editStatus }));
    ui.setEditStatus("Loaded 3 MUs");
    assert.equal(editStatus.textContent, "Loaded 3 MUs");
    ui.setEditStatus("");
    assert.equal(editStatus.textContent, "");
    const uiWithout = createUiService(createApp());
    assert.doesNotThrow(() => uiWithout.setEditStatus("ignored"));
  });
});
