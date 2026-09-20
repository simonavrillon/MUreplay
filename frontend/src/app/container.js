import { API_BASE } from "../config.js";
import { createApiClient } from "../api/client.js";
import { createApp } from "./create-app.js";
import { els } from "./dom.js";
import { apiJson, waitForBackend } from "./http.js";
import { state } from "./state.js";
import { setupImportEvents } from "./stages/import-stage.js";
import { setupLayoutEvents } from "./stages/layout-stage.js";
import { setupReplayEvents } from "./stages/replay-stage.js";
import { createReplayRenderer } from "../view/replay-renderer.js";

export async function initializeApp() {
  const app = createApp({
    state,
    els,
    api: createApiClient({ apiJson, API_BASE }),
  });

  const renderer = createReplayRenderer({
    els,
    state,
    currentStep: app.currentStep,
    isCurrentMuStep: app.isCurrentMuStep,
    pulseForCurrentMu: app.pulseForCurrentMu,
    distimesForCurrentMu: app.distimesForCurrentMu,
    artifactTimesForCurrentMu: app.artifactTimesForCurrentMu,
  });
  app.renderAll = renderer.renderAll;
  app.setRenderAll(renderer.renderAll);

  setupImportEvents(app);
  setupReplayEvents(app);
  setupLayoutEvents(app);
  renderer.bindTimeline();

  app.updateTimelineUi();
  renderer.renderAll();

  if (els.loadMenuBtn) els.loadMenuBtn.disabled = true;
  app.setStatus("Connecting to backend\u2026", "muted");

  const ready = await waitForBackend(app.api.healthUrl());
  if (ready) {
    if (els.loadMenuBtn) els.loadMenuBtn.disabled = false;
    app.setStatus("", "muted");
  } else {
    app.setStatus("Backend unreachable \u2014 please restart the app", "error");
  }

  if (!window.MUREPLAY_BIDS_ROOT) {
    app.api
      .fetchConfig()
      .then((cfg) => {
        if (cfg?.bids_root) window.MUREPLAY_BIDS_ROOT = cfg.bids_root;
      })
      .catch(() => {});
  }
}
