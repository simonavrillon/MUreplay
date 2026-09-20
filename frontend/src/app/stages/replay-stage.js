/**
 * Replay stage: binds the replay workspace controls (selectors, timeline,
 * play/pause) and the keyboard shortcuts to the app context.
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

    if (event.key === "ArrowLeft") {
      app.adjustReplayView("scroll_left");
      event.preventDefault();
      return;
    }
    if (event.key === "ArrowRight") {
      app.adjustReplayView("scroll_right");
      event.preventDefault();
      return;
    }
    if (event.key === "ArrowUp") {
      app.adjustReplayView("zoom_in");
      event.preventDefault();
      return;
    }
    if (event.key === "ArrowDown") {
      app.adjustReplayView("zoom_out");
      event.preventDefault();
      return;
    }
    if (event.key === " " || event.code === "Space") {
      app.togglePlay();
      event.preventDefault();
      return;
    }
    if (event.key === "<") {
      app.goToMu("prev");
      event.preventDefault();
      return;
    }
    if (event.key === ">") {
      app.goToMu("next");
      event.preventDefault();
    }
  });
}
