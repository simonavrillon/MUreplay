export function createLoaders({
  state,
  setStatus,
  setEditStatus,
  replay,
  renderAll,
  postJson,
  openDialogPath,
  buildMuUids,
  toOptionalInt,
  asNumberArray,
}) {
  async function onOpenDialog() {
    try {
      setEditStatus("Opening file dialog...");
      const path = await openDialogPath();
      if (!path) {
        setEditStatus("No file selected");
        return;
      }
      await onLoadByPath(path);
    } catch (err) {
      setEditStatus(`Dialog error: ${err.message}`);
    }
  }

  async function onLoadByPath(filePath) {
    filePath = (filePath || "").trim();
    if (!filePath) return;
    try {
      setEditStatus("Loading...");
      const parsed = await postJson("/api/load-paired-from-path", { file_path: filePath });
      const normalized = normalizeEditedPayload(parsed);
      state.editedFilename = parsed.source_filename || filePath.split("/").pop();
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
      state.editHistory = [];
      state.history = [];
      state.replayGroups = [];
      replay.initializeReplayFromLoadedData();
      state.currentGrid = replay.firstGridWithMu();
      const mus = replay.musForGrid(state.currentGrid);
      state.currentMu = mus.length ? mus[0] : 0;
      replay.fillGridSelect();
      replay.fillMuSelect();
      const embeddedHistory = Array.isArray(parsed.edit_history)
        ? parsed.edit_history
        : Array.isArray(parsed.history)
          ? parsed.history
          : [];
      if (embeddedHistory.length) {
        state.history = embeddedHistory.map((e, i) => normalizeLogEntry(e, i)).filter(Boolean);
        state.editHistory = [...embeddedHistory];
        replay.rebuildReplayGroups();
        replay.initializeReplayFromLoadedData();
        replay.resetReplayForCurrentMu();
      }
      replay.stopPlay();
      replay.updateTimelineUi();
      replay.applyTimelineStep();
      renderAll();
      setStatus("");
      setEditStatus(`Loaded ${state.distimes.length} MUs + ${replay.getActiveReplayGroups().length} replay steps`);
    } catch (err) {
      setEditStatus(`Path load error: ${err.message}`);
    }
  }

  function normalizeEditedPayload(source) {
    const pulseTrains = source.pulse_trains || source.pulseTrains;
    const distimes = source.discharge_times || source.distimes;
    if (!Array.isArray(pulseTrains) || !Array.isArray(distimes)) {
      throw new Error("Expected pulse_trains and discharge_times arrays");
    }

    const fsamp = Number(source.fsamp || source.fs || 2048) || 2048;
    const muCount = distimes.length;
    const gridNames = Array.isArray(source.grid_names) && source.grid_names.length
      ? source.grid_names.map((v) => String(v))
      : ["Grid 1"];
    const muGridIndex = Array.isArray(source.mu_grid_index) && source.mu_grid_index.length === muCount
      ? source.mu_grid_index.map((v) => Number(v) || 0)
      : new Array(muCount).fill(0);
    const muUids = Array.isArray(source.mu_uids) && source.mu_uids.length === muCount
      ? source.mu_uids.map((v) => String(v))
      : buildMuUids(muGridIndex);

    const artifactTimes = Array.isArray(source.artifact_times)
      ? source.artifact_times.map((row) => (Array.isArray(row) ? row.map(Number) : []))
      : [];

    return {
      fsamp,
      pulseTrains: pulseTrains.map((row) => (Array.isArray(row) ? row.map(Number) : [])),
      distimes: distimes.map((row) => (Array.isArray(row) ? row.map((n) => Number(n) || 0) : [])),
      gridNames,
      muGridIndex,
      muUids,
      artifactTimes,
    };
  }

  function normalizeLogEntry(entry, idx) {
    if (!entry || typeof entry !== "object") return null;
    const timestamp = String(entry.timestamp || entry.time || `step-${idx + 1}`);
    const type = String(entry.type || entry.action || entry.op || "unknown");
    const muUid = entry.mu_uid ? String(entry.mu_uid) : "";
    let muIdx = Number.isFinite(Number(entry.mu_idx)) ? Number(entry.mu_idx) : -1;
    if (muIdx < 0 && muUid) {
      muIdx = state.muUids.indexOf(muUid);
    }

    const viewStart = toOptionalInt(entry.view_start ?? entry.start);
    const viewEnd = toOptionalInt(entry.view_end ?? entry.end);
    const spikesAdded = asNumberArray(entry.spikes_added);
    const spikesRemoved = asNumberArray(entry.spikes_removed);
    const artifactsAdded = asNumberArray(entry.artifacts_added);
    const artifactsRemoved = asNumberArray(entry.artifacts_removed);
    const usePeeloff = !!entry.use_peeloff;
    const lockSpikes = !!entry.lock_spikes;

    return {
      idx,
      timestamp,
      type,
      muUid,
      muIdx,
      viewStart,
      viewEnd,
      spikesAdded,
      spikesRemoved,
      artifactsAdded,
      artifactsRemoved,
      usePeeloff,
      lockSpikes,
      raw: entry,
    };
  }

  return {
    onLoadByPath,
    onOpenDialog,
  };
}
