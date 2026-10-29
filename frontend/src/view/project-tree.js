/**
 * Project tree renderer: the BIDS projects in the data folder, as nested
 * folds (project, subject, session) over the trials, each a button holding
 * its edit log's path. Redrawing keeps the folds that were open and the
 * trial that was opened.
 */

/** @typedef {import("../app/dom.js").Els} Els */
/** @typedef {import("../app/context.js").ProjectList} ProjectList */
/** @typedef {import("../app/context.js").ProjectTrial} ProjectTrial */

/**
 * A fold named `label`, keyed by its place in the tree so a redraw can reopen it.
 *
 * @param {string} key
 * @param {string} label
 * @param {Set<string>} open
 * @param {Node[]} children
 * @param {Node} [icon]
 */
function fold(key, label, open, children, icon) {
  const details = document.createElement("details");
  details.className = "tree-fold";
  details.dataset.key = key;
  details.open = open.has(key);
  const summary = document.createElement("summary");
  if (icon) summary.append(icon);
  const name = document.createElement("span");
  name.textContent = label;
  summary.append(name);
  const content = document.createElement("div");
  content.className = "tree-children";
  content.append(...children);
  details.append(summary, content);
  return details;
}

/**
 * @param {ProjectTrial[]} trials
 * @param {string} openedPath
 */
function trialButtons(trials, openedPath) {
  return trials.map(({ name, path }) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "tree-trial";
    button.dataset.path = path;
    button.title = path;
    button.textContent = name;
    if (path === openedPath) button.setAttribute("aria-current", "true");
    return button;
  });
}

/**
 * @param {Els} els
 * @param {ProjectList} list
 */
export function renderProjectTree(els, { projects, dataRoot }) {
  const tree = els.projectTree;
  const open = new Set(
    Array.from(tree.querySelectorAll("details[open]"), (d) =>
      d instanceof HTMLElement ? (d.dataset.key ?? "") : "",
    ),
  );
  const current = tree.querySelector(".tree-trial[aria-current]");
  const openedPath =
    current instanceof HTMLElement ? (current.dataset.path ?? "") : "";

  tree.replaceChildren(
    ...projects.map((project) => {
      const subjects = project.subjects.map((subject) => {
        const key = `${project.name}/${subject.name}`;
        // A subject recorded without sessions holds its trials directly.
        /** @type {HTMLElement[]} */
        const sessions = [];
        for (const session of subject.sessions) {
          const trials = trialButtons(session.trials, openedPath);
          if (!session.name) sessions.push(...trials);
          else
            sessions.push(
              fold(`${key}/${session.name}`, session.name, open, trials),
            );
        }
        return fold(key, subject.name, open, sessions);
      });
      // A project row shows the section header's folder icon.
      const icon = els.projectsHeader.querySelector("svg")?.cloneNode(true);
      return fold(project.name, project.name, open, subjects, icon);
    }),
  );
  els.projectTreeHint.hidden = projects.length > 0;
  els.projectTreeHint.textContent = `No BIDS project in ${dataRoot}. Set MUREPLAY_DATA_ROOT to the folder that holds yours, then reopen this section.`;
}

/**
 * Mark the trial whose edit log is at `path` as the one opened.
 *
 * @param {Els} els
 * @param {string} path
 */
export function markOpenedTrial(els, path) {
  for (const button of els.projectTree.querySelectorAll(".tree-trial")) {
    if (!(button instanceof HTMLElement)) continue;
    if (button.dataset.path === path)
      button.setAttribute("aria-current", "true");
    else button.removeAttribute("aria-current");
  }
}
