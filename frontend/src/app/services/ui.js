/**
 * The UI service: the workspace's status line, where the replay reports.
 */

/** @typedef {import("../context.js").UiService} UiService */

/**
 * @param {import("../context.js").App} app
 * @returns {UiService}
 */
export function createUiService(app) {
  const { els } = app;

  /** @type {UiService["setReplayStatus"]} */
  function setReplayStatus(text, tone = "muted") {
    els.replayStatus.textContent = text;
    els.replayStatus.dataset.tone = tone;
  }

  return { setReplayStatus };
}
