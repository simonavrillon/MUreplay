/**
 * Replay stage: binds the replay workspace controls (selectors, timeline,
 * play/pause, the timeline bar's drag and click) and the keyboard shortcuts.
 */
import { setReplayView } from "../../state/actions.js";
import { getReplayView, pulseForCurrentMu } from "../../state/selectors.js";
import { TIMELINE_PADDING } from "../../view/replay-renderer.js";

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

  els.editMuGridSelect.addEventListener("change", app.onGridChange);
  els.editMuSelect.addEventListener("change", app.onMuChange);
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
  const canvas = els.editTimelineCanvas;
  if (!canvas) return;

  let dragging = false;
  let didMove = false;
  let startClientX = 0;
  let dragViewStart = 0;

  /** @param {number} clientWidth */
  const barWidth = (clientWidth) =>
    Math.max(1, clientWidth - TIMELINE_PADDING.left - TIMELINE_PADDING.right);

  /**
   * Show `[start, end)`, shifted back inside the recording.
   *
   * @param {number} start
   * @param {number} end
   * @param {number} total
   */
  const showView = (start, end, total) => {
    if (start < 0) {
      end -= start;
      start = 0;
    }
    if (end > total) {
      start = Math.max(0, start - (end - total));
      end = total;
    }
    if (end <= start) end = Math.min(total, start + 1);
    setReplayView(state, { start, end });
    app.renderAll();
  };

  canvas.addEventListener("mousedown", (e) => {
    const total = pulseForCurrentMu(state).length;
    if (!total) return;
    dragging = true;
    didMove = false;
    startClientX = e.clientX;
    dragViewStart = getReplayView(state, total).start;
  });

  window.addEventListener("mousemove", (e) => {
    if (!dragging) return;
    if (Math.abs(e.clientX - startClientX) > DRAG_THRESHOLD_PX) didMove = true;
    if (!didMove) return;
    const total = pulseForCurrentMu(state).length;
    if (!total) return;
    const rect = canvas.getBoundingClientRect();
    const delta = Math.round(
      ((e.clientX - startClientX) / barWidth(rect.width)) * total,
    );
    const view = getReplayView(state, total);
    const span = view.end - view.start;
    showView(dragViewStart + delta, dragViewStart + delta + span, total);
  });

  window.addEventListener("mouseup", (e) => {
    if (!dragging) return;
    dragging = false;
    if (didMove) return;
    const total = pulseForCurrentMu(state).length;
    if (!total) return;
    const view = getReplayView(state, total);
    const span = view.end - view.start;
    const rect = canvas.getBoundingClientRect();
    const frac = Math.max(
      0,
      Math.min(
        1,
        (e.clientX - rect.left - TIMELINE_PADDING.left) / barWidth(rect.width),
      ),
    );
    const start = Math.round(frac * total - span / 2);
    showView(start, start + span, total);
  });
}
