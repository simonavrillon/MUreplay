/**
 * The composition root: builds the app context, binds the stages, and waits
 * for the backend before enabling file loading.
 */
import { createApiClient } from "../api/client.js";
import { apiJson, waitForBackend } from "../api/http.js";
import { state } from "../state/state.js";
import { createReplayRenderer } from "../view/replay-renderer.js";
import { createApp } from "./create-app.js";
import { els } from "./dom.js";
import { setupImportEvents } from "./stages/import-stage.js";
import { setupLayoutEvents } from "./stages/layout-stage.js";
import { setupReplayEvents } from "./stages/replay-stage.js";

export async function initializeApp() {
  const app = createApp({
    state,
    els,
    api: createApiClient({ apiJson }),
  });
  app.renderAll = createReplayRenderer({ els, state }).renderAll;

  setupImportEvents(app);
  setupReplayEvents(app);
  setupLayoutEvents(app);

  app.updateTimelineUi();
  app.renderAll();

  els.loadMenuBtn.disabled = true;
  app.setStatus("Connecting to the backend…");

  const ready = await waitForBackend(app.api.healthUrl());
  if (ready) {
    els.loadMenuBtn.disabled = false;
    app.setStatus("");
  } else {
    app.setStatus(
      "The backend did not answer. Quit MUreplay and launch it again.",
      "error",
    );
  }
}
