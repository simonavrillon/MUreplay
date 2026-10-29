/**
 * Layout stage: the page stepper, the settings rail (its toggle and
 * collapsible sections, as MUedit2 binds them), and the redraw on resize.
 */

/**
 * @param {import("../context.js").App} app
 */
export function setupLayoutEvents(app) {
  const { els } = app;

  els.stepAudit.addEventListener("click", () => app.switchStage("audit"));
  els.stepMonitor.addEventListener("click", () => app.switchStage("monitor"));

  els.settingsPanel.querySelectorAll(".section-header").forEach((head) => {
    head.setAttribute("tabindex", "0");
    const toggle = () => {
      const section = head.parentElement;
      if (!section) return;
      // A click on a rail icon expands the panel and opens that section.
      if (!els.workspace.classList.contains("settings-open")) {
        app.setSettingsOpen(true);
        section.classList.remove("collapsed");
        head.setAttribute("aria-expanded", "true");
        return;
      }
      const isCollapsed = section.classList.toggle("collapsed");
      head.setAttribute("aria-expanded", isCollapsed ? "false" : "true");
    };
    head.addEventListener("click", toggle);
    head.addEventListener("keydown", (e) => {
      const { key } = /** @type {KeyboardEvent} */ (e);
      // Through click, so the header's other listeners hear it too.
      if (key === " " || key === "Enter") {
        e.preventDefault();
        /** @type {HTMLElement} */ (head).click();
      }
    });
  });

  els.settingsToggleBtn.addEventListener("click", () =>
    app.setSettingsOpen(!els.workspace.classList.contains("settings-open")),
  );
  els.settingsOverlay.addEventListener("click", () =>
    app.setSettingsOpen(false),
  );
  window.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && els.workspace.classList.contains("settings-open"))
      app.setSettingsOpen(false);
  });

  window.addEventListener("resize", () => {
    app.positionStepIndicator();
    app.renderAll();
  });
}
