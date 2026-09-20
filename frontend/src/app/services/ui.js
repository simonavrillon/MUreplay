/**
 * UI service: status bar and edit-status updates.
 * @param {import("../context.js").App} app
 */
export function createUiService(app) {
  /**
   * @param {string} text
   * @param {import("../context.js").Tone} [tone]
   */
  function setStatus(text, tone) {
    const el = app.els.status;
    if (!el) return;
    el.textContent = text || "";
    el.classList.toggle("hidden", !text);
    if (tone) {
      el.classList.remove("muted", "success", "error");
      el.classList.add(tone);
    }
  }

  /**
   * @param {string} text
   */
  function setEditStatus(text) {
    const el = app.els.editStatus;
    if (el) el.textContent = text || "";
  }

  return { setStatus, setEditStatus };
}
