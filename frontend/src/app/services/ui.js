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
    if (!els.status) return;
    els.status.textContent = text;
    els.status.title = text;
    els.status.dataset.tone = tone;
    els.status.hidden = !text;
  }

  /** @type {UiService["setEditStatus"]} */
  function setEditStatus(text) {
    if (els.editStatus) els.editStatus.textContent = text;
  }

  return { setStatus, setEditStatus };
}
