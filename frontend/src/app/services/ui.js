/**
 * The UI service: the two status lines, the header's for the app and the
 * workspace's for the replay.
 */

/** @typedef {import("../context.js").UiService} UiService */

/**
 * @param {import("../context.js").App} app
 * @returns {UiService}
 */
export function createUiService(app) {
  const { els } = app;

  /** @type {UiService["setStatus"]} */
  function setStatus(text, tone = "muted") {
    els.status.textContent = text;
    els.status.title = text;
    els.status.dataset.tone = tone;
    els.status.hidden = !text;
  }

  /** @type {UiService["setReplayStatus"]} */
  function setReplayStatus(text, tone = "muted") {
    els.replayStatus.textContent = text;
    els.replayStatus.dataset.tone = tone;
  }

  return { setStatus, setReplayStatus };
}
