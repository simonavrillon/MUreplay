/**
 * The composition root: builds the app context, binds the stages, and waits
 * for the backend before enabling file loading.
 */
import { API_BASE } from "../config.js";
import { createApiClient } from "../api/client.js";
import { setDataRoot } from "../state/actions.js";
import { state } from "../state/state.js";
import { createReplayRenderer } from "../view/replay-renderer.js";
import { createApp } from "./create-app.js";
import { els } from "./dom.js";
import { apiJson, waitForBackend } from "./http.js";
import { setupImportEvents } from "./stages/import-stage.js";
import { setupLayoutEvents } from "./stages/layout-stage.js";
import { setupReplayEvents } from "./stages/replay-stage.js";

export async function initializeApp() {
  const app = createApp({
    state,
    els,
    api: createApiClient({ apiJson, API_BASE }),
  });
  app.renderAll = createReplayRenderer({ els, state }).renderAll;

  setupImportEvents(app);
  setupReplayEvents(app);
  setupLayoutEvents(app);

  app.updateTimelineUi();
  app.renderAll();

  if (els.loadMenuBtn) els.loadMenuBtn.disabled = true;
  app.setStatus("Connecting to backend…");

  const ready = await waitForBackend(app.api.healthUrl());
  if (ready) {
    if (els.loadMenuBtn) els.loadMenuBtn.disabled = false;
    app.setStatus("");
  } else {
    app.setStatus("Backend unreachable — please restart the app", "error");
  }

  try {
    const cfg = await app.api.fetchConfig();
    if (cfg?.bids_root) setDataRoot(state, String(cfg.bids_root));
  } catch {
    // Without it, a session whose file names no dataset cannot refit; the rest works.
  }
}
