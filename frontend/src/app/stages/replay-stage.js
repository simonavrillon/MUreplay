/**
 * Replay stage: binds the replay workspace controls (selectors, timeline,
 * play/pause, the timeline bar's drag and click) and the keyboard shortcuts.
 */
import { clamp, shiftViewInside } from "../../replay/operations.js";
import { setReplayView } from "../../state/actions.js";
import {
  clampedReplayView,
  pulseTrainForCurrentMu,
} from "../../state/selectors.js";
import { PLOT_PADDING } from "../../view/plots.js";
import { timelineBarWidth } from "../../view/replay-renderer.js";

/** Pixels the pointer moves before a press on the timeline bar becomes a drag. */
const DRAG_THRESHOLD_PX = 3;

/** @type {Record<string, (app: import("../context.js").App) => void>} */
const SHORTCUTS = {
  ArrowLeft: (app) => app.adjustReplayView("scroll_left"),
  ArrowRight: (app) => app.adjustReplayView("scroll_right"),
  ArrowUp: (app) => app.adjustReplayView("zoom_in"),
  ArrowDown: (app) => app.adjustReplayView("zoom_out"),
  " ": (app) => app.togglePlay(),
  "<": (app) => app.goToMu("prev"),
  ">": (app) => app.goToMu("next"),
};

/**
 * @param {import("../context.js").App} app
 */
export function setupReplayEvents(app) {
  const { els } = app;

  els.gridSelect.addEventListener("change", app.onGridChange);
  els.muSelect.addEventListener("change", app.onMuChange);
  els.timelineSlider.addEventListener("input", app.onTimelineChange);
  els.prevStepBtn.addEventListener("click", () => app.moveStep(-1));
  els.nextStepBtn.addEventListener("click", () => app.moveStep(1));
  els.playPauseBtn.addEventListener("click", app.togglePlay);

  window.addEventListener("keydown", (event) => {
    const active = document.activeElement;
    if (active && ["INPUT", "TEXTAREA", "SELECT"].includes(active.tagName))
      return;
    const shortcut = SHORTCUTS[event.code === "Space" ? " " : event.key];
    if (!shortcut) return;
    shortcut(app);
    event.preventDefault();
  });

  bindTimelineBar(app);
}

/**
 * Drag the timeline bar to pan the view; click it to centre the view there.
 *
 * @param {import("../context.js").App} app
 */
function bindTimelineBar(app) {
  const { els, state } = app;
  const canvas = els.timelineCanvas;

  let dragging = false;
  let didMove = false;
  let startClientX = 0;
  let dragViewStart = 0;

  /**
   * Show `[start, end)`, shifted back inside the recording.
   *
   * @param {number} start
   * @param {number} end
   * @param {number} totalSamples
   */
  const showView = (start, end, totalSamples) => {
    setReplayView(state, shiftViewInside(start, end, totalSamples));
    app.renderAll();
  };

  canvas.addEventListener("mousedown", (e) => {
    const totalSamples = pulseTrainForCurrentMu(state).length;
    if (!totalSamples) return;
    dragging = true;
    didMove = false;
    startClientX = e.clientX;
    dragViewStart = clampedReplayView(state, totalSamples).start;
  });

  window.addEventListener("mousemove", (e) => {
    if (!dragging) return;
    if (Math.abs(e.clientX - startClientX) > DRAG_THRESHOLD_PX) didMove = true;
    if (!didMove) return;
    const totalSamples = pulseTrainForCurrentMu(state).length;
    if (!totalSamples) return;
    const rect = canvas.getBoundingClientRect();
    const delta = Math.round(
      ((e.clientX - startClientX) / timelineBarWidth(rect.width)) *
        totalSamples,
    );
    const view = clampedReplayView(state, totalSamples);
    const span = view.end - view.start;
    showView(dragViewStart + delta, dragViewStart + delta + span, totalSamples);
  });

  window.addEventListener("mouseup", (e) => {
    if (!dragging) return;
    dragging = false;
    if (didMove) return;
    const totalSamples = pulseTrainForCurrentMu(state).length;
    if (!totalSamples) return;
    const view = clampedReplayView(state, totalSamples);
    const span = view.end - view.start;
    const rect = canvas.getBoundingClientRect();
    const frac = clamp(
      (e.clientX - rect.left - PLOT_PADDING.left) /
        timelineBarWidth(rect.width),
      0,
      1,
    );
    const start = Math.round(frac * totalSamples - span / 2);
    showView(start, start + span, totalSamples);
  });
}
