import { createCharts } from "./modules/charts.js";
import { createLoaders } from "./modules/loaders.js";
import { postJson, fetchConfig, openDialogPath, waitForBackend, apiUrl } from "./modules/api.js";
import { createReplayController } from "./modules/replay.js";
import { COLORS, UNIFORM_PULSE_COLOR, els, state } from "./modules/state.js";
import { asNumberArray, buildMuUids, clamp, inferEntityLabel, toOptionalInt } from "./modules/utils.js";

function setStatus(text) {
  els.status.textContent = text;
  els.status.classList.toggle("hidden", !text);
}

function setEditStatus(text) {
  els.editStatus.textContent = text;
}

function getBidsRoot() {
  return state.bidsRoot || String(window.MUREPLAY_BIDS_ROOT || "").trim();
}

function getEntityLabel() {
  if (state.bidsEntityLabel) return state.bidsEntityLabel;
  if (state.entityLabel) return state.entityLabel;
  const fromConfig = String(window.MUREPLAY_ENTITY_LABEL || "").trim();
  if (fromConfig) return fromConfig;
  return inferEntityLabel(state.editedFilename);
}

function getNbextchan() {
  const fromConfig = Number(window.MUREPLAY_NBEXTCHAN);
  if (Number.isFinite(fromConfig) && fromConfig > 0) return fromConfig;
  return 1000;
}

const replay = createReplayController({
  state,
  els,
  postJson,
  setEditStatus,
  getBidsRoot,
  getEntityLabel,
  getNbextchan,
  clamp,
});

const { renderAll } = createCharts({
  els,
  state,
  COLORS,
  UNIFORM_PULSE_COLOR,
  currentStep: replay.currentStep,
  isCurrentMuStep: replay.isCurrentMuStep,
  pulseForCurrentMu: replay.pulseForCurrentMu,
  distimesForCurrentMu: replay.distimesForCurrentMu,
  artifactTimesForCurrentMu: () => state.artifactTimes?.[state.currentMu] || [],
});
replay.setRenderAll(renderAll);

const loaders = createLoaders({
  state,
  setStatus,
  setEditStatus,
  replay,
  renderAll,
  postJson,
  openDialogPath,
  buildMuUids,
  toOptionalInt,
  asNumberArray,
});

function onWindowKeydown(event) {
  const active = document.activeElement;
  if (active && ["INPUT", "TEXTAREA", "SELECT"].includes(active.tagName)) return;

  if (event.key === "ArrowLeft") {
    replay.adjustReplayView("scroll_left");
    event.preventDefault();
    return;
  }
  if (event.key === "ArrowRight") {
    replay.adjustReplayView("scroll_right");
    event.preventDefault();
    return;
  }
  if (event.key === "ArrowUp") {
    replay.adjustReplayView("zoom_in");
    event.preventDefault();
    return;
  }
  if (event.key === "ArrowDown") {
    replay.adjustReplayView("zoom_out");
    event.preventDefault();
    return;
  }
  if (event.key === " " || event.code === "Space") {
    replay.togglePlay();
    event.preventDefault();
    return;
  }
  if (event.key === "<") {
    replay.goToMu("prev");
    event.preventDefault();
    return;
  }
  if (event.key === ">") {
    replay.goToMu("next");
    event.preventDefault();
  }
}

els.loadMenuBtn?.addEventListener("click", () => {
  void loaders.onOpenDialog();
});
els.editMuGridSelect.addEventListener("change", replay.onGridChange);
els.editMuSelect.addEventListener("change", replay.onMuChange);
els.timelineSlider.addEventListener("input", replay.onTimelineChange);
els.prevStepBtn.addEventListener("click", () => replay.moveStep(-1));
els.nextStepBtn.addEventListener("click", () => replay.moveStep(1));
els.playPauseBtn.addEventListener("click", replay.togglePlay);
window.addEventListener("keydown", onWindowKeydown);
window.addEventListener("resize", renderAll);

replay.updateTimelineUi();
renderAll();

(async () => {
  if (els.loadMenuBtn) els.loadMenuBtn.disabled = true;
  setStatus("Connecting to backend…");
  const ready = await waitForBackend(apiUrl("/api/health"));
  if (ready) {
    if (els.loadMenuBtn) els.loadMenuBtn.disabled = false;
    setStatus("");
  } else {
    setStatus("Backend unreachable — please restart the app");
  }
  if (!window.MUREPLAY_BIDS_ROOT) {
    fetchConfig()
      .then((cfg) => {
        if (cfg?.bids_root) window.MUREPLAY_BIDS_ROOT = cfg.bids_root;
      })
      .catch(() => {});
  }
})();
