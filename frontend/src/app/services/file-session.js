/**
 * File session service: opening a session from the native dialog. The loaded
 * decomposition replaces the shown one through `beginSession`; its log,
 * normalised, then starts the replay.
 */
import { normalizeSessionPayload } from "../../api/payloads.js";
import { beginSession } from "../../state/transitions.js";
import { handleError } from "./error-service.js";

/** @typedef {import("../context.js").FileSessionService} FileSessionService */

/**
 * @param {import("../context.js").App} app
 * @returns {FileSessionService}
 */
export function createFileSessionService(app) {
  const { state } = app;

  /** @type {FileSessionService["onOpenDialog"]} */
  async function onOpenDialog() {
    let path;
    try {
      app.setReplayStatus("Opening the file dialog…");
      ({ path } = await app.api.openFileDialog());
    } catch (err) {
      handleError(err, app.setReplayStatus, "Could not open the file dialog");
      return;
    }
    if (!path) {
      app.setReplayStatus("No file selected.");
      return;
    }
    await loadSession(path);
  }

  /** @param {string} filePath */
  async function loadSession(filePath) {
    try {
      app.setReplayStatus("Loading the session…");
      const payload = normalizeSessionPayload(
        await app.api.loadPairedFromPath(filePath),
      );
      beginSession(state, payload);
      app.startReplay();
      app.setStatus("");
      const nMu = state.spikeTimes.length;
      const nSteps = state.timelineGroups.length;
      app.setReplayStatus(
        `Loaded ${nMu} MU${nMu === 1 ? "" : "s"} and ${nSteps} replay step${nSteps === 1 ? "" : "s"}.`,
      );
    } catch (err) {
      handleError(err, app.setReplayStatus, "Could not load the session");
    }
  }

  return { onOpenDialog };
}
