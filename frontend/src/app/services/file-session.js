/**
 * File session service: listing the projects in the data folder, choosing
 * another data folder, and opening a session from one of its trials. The loaded
 * decomposition replaces the shown one through `beginSession`; its log,
 * normalised, then starts the replay.
 */
import {
  normalizeDataFolder,
  normalizeProjectList,
  normalizeSessionPayload,
} from "../../api/payloads.js";
import { beginSession } from "../../state/transitions.js";
import { handleError } from "./error-service.js";

/** @typedef {import("../context.js").FileSessionService} FileSessionService */

/**
 * @param {import("../context.js").App} app
 * @returns {FileSessionService}
 */
export function createFileSessionService(app) {
  const { state } = app;

  /** @type {FileSessionService["loadProjects"]} */
  async function loadProjects() {
    try {
      app.showProjects(normalizeProjectList(await app.api.listProjects()));
    } catch (err) {
      handleError(err, app.setReplayStatus, "Could not list the projects");
    }
  }

  /** @type {FileSessionService["onChooseDataFolder"]} */
  async function onChooseDataFolder() {
    let dataRoot;
    try {
      app.setReplayStatus("Opening the folder dialog…");
      ({ dataRoot } = normalizeDataFolder(await app.api.chooseDataFolder()));
    } catch (err) {
      handleError(err, app.setReplayStatus, "Could not change the data folder");
      return;
    }
    if (!dataRoot) {
      app.setReplayStatus("The data folder is unchanged.");
      return;
    }
    app.setReplayStatus(`The data folder is now ${dataRoot}.`);
    await loadProjects();
  }

  /** @type {FileSessionService["loadSession"]} */
  async function loadSession(filePath) {
    try {
      app.setReplayStatus("Loading the session…");
      const payload = normalizeSessionPayload(
        await app.api.loadPairedFromPath(filePath),
      );
      beginSession(state, payload);
      app.showSessionSettings(payload);
      app.showOpenedTrial(filePath);
      app.startReplay();
      const nMu = state.spikeTimes.length;
      const nSteps = state.timelineGroups.length;
      app.setReplayStatus(
        `Loaded ${nMu} MU${nMu === 1 ? "" : "s"} and ${nSteps} replay step${nSteps === 1 ? "" : "s"}.`,
      );
    } catch (err) {
      handleError(err, app.setReplayStatus, "Could not load the session");
    }
  }

  return { loadProjects, loadSession, onChooseDataFolder };
}
