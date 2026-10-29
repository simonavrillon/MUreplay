/**
 * The composition root: builds the app context and binds the stages. The
 * server that serves this page also answers the API, so it is already up.
 */
import { createApiClient } from "../api/client.js";
import { apiJson } from "../api/http.js";
import { state } from "../state/state.js";
import { createReplayRenderer } from "../view/replay-renderer.js";
import { createApp } from "./create-app.js";
import { els } from "./dom.js";
import { setupImportEvents } from "./stages/import-stage.js";
import { setupLayoutEvents } from "./stages/layout-stage.js";
import { setupReplayEvents } from "./stages/replay-stage.js";

export function initializeApp() {
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
  void app.loadProjects();
  // The chips' widths depend on the web font, which may load after this.
  app.positionStepIndicator();
  void document.fonts.ready.then(() => app.positionStepIndicator());
}
