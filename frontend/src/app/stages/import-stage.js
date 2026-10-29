/**
 * Import stage: the settings rail's project tree, where a trial opens its
 * session, and the button that picks another data folder for the tree.
 */

/**
 * @param {import("../context.js").App} app
 */
export function setupImportEvents(app) {
  const { els } = app;

  // The data folder may have changed since the tree was drawn: a click on the
  // section's header redraws it.
  els.projectsHeader.addEventListener("click", () => {
    void app.loadProjects();
  });
  els.projectTree.addEventListener("click", (e) => {
    const trial =
      e.target instanceof Element ? e.target.closest(".tree-trial") : null;
    if (!(trial instanceof HTMLElement) || !trial.dataset.path) return;
    // The rail covers the plots the session draws on.
    app.setSettingsOpen(false);
    void app.loadSession(trial.dataset.path);
  });
  els.dataFolderBtn.addEventListener("click", () => {
    void app.onChooseDataFolder();
  });
}
