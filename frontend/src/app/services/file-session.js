/**
 * File session service: opening a session, from the native dialog or a path.
 * The loaded decomposition replaces the shown one through `beginSession`; its
 * log, normalised, then starts the replay.
 */
import {
  normalizeEditedPayload,
  normalizeLogEntry,
} from "../../api/payloads.js";
import { basename } from "../../io/bids.js";
import { setHistory } from "../../state/actions.js";
import { getActiveReplayGroups } from "../../state/selectors.js";
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
    try {
      app.setEditStatus("Opening file dialog...");
      const result = await app.api.openFileDialog();
      const path = result?.path;
      if (!path) {
        app.setEditStatus("No file selected");
        return;
      }
      await onLoadByPath(path);
    } catch (err) {
      handleError(err, app.setEditStatus, "Dialog error");
    }
  }

  /** @type {FileSessionService["onLoadByPath"]} */
  async function onLoadByPath(filePath) {
    filePath = (filePath || "").trim();
    if (!filePath) return;
    try {
      app.setEditStatus("Loading...");
      const parsed = await app.api.loadPairedFromPath(filePath);
      const payload = normalizeEditedPayload(parsed);
      beginSession(
        state,
        {
          filename: parsed.source_filename || basename(filePath),
          bidsRoot: parsed.bids_root || "",
          entityLabel: parsed.entity_label || "",
          bidsEntityLabel: parsed.bids_entity_label || "",
        },
        payload,
      );
      const log = Array.isArray(parsed.edit_history)
        ? parsed.edit_history
        : Array.isArray(parsed.history)
          ? parsed.history
          : [];
      setHistory(
        state,
        log
          .map((entry, i) => normalizeLogEntry(entry, i, state.muUids))
          .filter((entry) => entry !== null),
        [...log],
      );
      app.startReplay();
      app.setStatus("");
      app.setEditStatus(
        `Loaded ${state.distimes.length} MUs + ${getActiveReplayGroups(state).length} replay steps`,
      );
    } catch (err) {
      handleError(err, app.setEditStatus, "Path load error");
    }
  }

  return { onOpenDialog, onLoadByPath };
}
