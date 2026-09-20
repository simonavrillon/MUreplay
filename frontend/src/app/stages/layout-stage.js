/**
 * Layout stage: window resize re-render.
 * @param {import("../context.js").App} app
 */
export function setupLayoutEvents(app) {
  window.addEventListener("resize", () => app.renderAll());
}
