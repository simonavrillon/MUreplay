/**
 * File session service: file loading via native dialog and path.
 * Handles payload normalization and state population on load.
 */
import {
  normalizeEditedPayload,
  normalizeLogEntry,
} from "../../api/payloads.js";
import { buildMuUids } from "../../io/utils.js";

/**
 * @param {import("../context.js").App} app
 */
export function createFileSessionService(app) {
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
      app.setEditStatus(
        `Dialog error: ${err instanceof Error ? err.message : err}`,
      );
    }
  }

  /**
   * @param {string} filePath
   */
  async function onLoadByPath(filePath) {
    filePath = (filePath || "").trim();
    if (!filePath) return;
    try {
      app.setEditStatus("Loading...");
      const parsed = await app.api.loadPairedFromPath(filePath);
      const normalized = normalizeEditedPayload(parsed, buildMuUids);
      const { state } = app;
      state.editedFilename =
        parsed.source_filename || filePath.split("/").pop();
      state.logFilename = state.editedFilename;
      state.loadedFromDecomp = true;
      state.bidsRoot = parsed.bids_root || "";
      state.entityLabel = parsed.entity_label || "";
      state.bidsEntityLabel = parsed.bids_entity_label || "";
      state.fsamp = normalized.fsamp;
      state.pulseTrains = normalized.pulseTrains;
      state.distimes = normalized.distimes;
      state.gridNames = normalized.gridNames;
      state.muGridIndex = normalized.muGridIndex;
      state.muUids = normalized.muUids;
      state.artifactTimes = normalized.artifactTimes;
      state.artifactRegions = normalized.artifactRegions;
      state.editHistory = [];
      state.history = [];
      state.replayGroups = [];
      app.initializeReplayFromLoadedData();
      state.currentGrid = app.firstGridWithMu();
      const mus = app.musForGrid(state.currentGrid);
      state.currentMu = mus.length ? mus[0] : 0;
      app.fillGridSelect();
      app.fillMuSelect();
      const embeddedHistory = Array.isArray(parsed.edit_history)
        ? parsed.edit_history
        : Array.isArray(parsed.history)
          ? parsed.history
          : [];
      if (embeddedHistory.length) {
        state.history = embeddedHistory
          .map((e, i) => normalizeLogEntry(e, i, state.muUids))
          .filter((entry) => entry !== null);
        state.editHistory = [...embeddedHistory];
        app.rebuildReplayGroups();
        app.initializeReplayFromLoadedData();
        app.resetReplayForCurrentMu();
      }
      app.stopPlay();
      app.updateTimelineUi();
      app.applyTimelineStep();
      app.renderAll();
      app.setStatus("");
      app.setEditStatus(
        `Loaded ${state.distimes.length} MUs + ${app.getActiveReplayGroups().length} replay steps`,
      );
    } catch (err) {
      app.setEditStatus(
        `Path load error: ${err instanceof Error ? err.message : err}`,
      );
    }
  }

  return { onOpenDialog, onLoadByPath };
}
