/**
 * Import stage: binds the header's file-open control.
 */

/**
 * @param {import("../context.js").App} app
 */
export function setupImportEvents(app) {
  app.els.loadMenuBtn.addEventListener("click", () => {
    void app.onOpenDialog();
  });
}
