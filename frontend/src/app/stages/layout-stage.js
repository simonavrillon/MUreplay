/**
 * Layout stage: redraws the plots when the window resizes.
 */

/**
 * @param {import("../context.js").App} app
 */
export function setupLayoutEvents(app) {
  window.addEventListener("resize", () => app.renderAll());
}
