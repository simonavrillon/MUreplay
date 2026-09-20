/**
 * Replay service: the core replay engine.
 *
 * Handles timeline navigation, step grouping, forward/backward application
 * of logged edits, and the update_filter API call for real recomputation.
 */
import {
  applyLoggedDiffBackward,
  applyLoggedDiffForward,
  isSpikeEditStep,
  stepMuKey,
} from "../../replay/operations.js";
import { clamp, extent, inferEntityLabel } from "../../io/utils.js";

/** @typedef {import("../state.js").EditLogEntry} EditLogEntry */
/** @typedef {import("../state.js").ReplayGroup} ReplayGroup */

/**
 * @param {import("../context.js").App} app
 */
export function createReplayService(app) {
  const { state, els, api } = app;
  let renderAll = () => {};

  /**
   * @param {() => void} fn
   */
  function setRenderAll(fn) {
    renderAll = typeof fn === "function" ? fn : () => {};
  }

  function getBidsRoot() {
    return state.bidsRoot || String(window.MUREPLAY_BIDS_ROOT || "").trim();
  }

  function getEntityLabel() {
    if (state.bidsEntityLabel) return state.bidsEntityLabel;
    if (state.entityLabel) return state.entityLabel;
    return inferEntityLabel(state.editedFilename);
  }

  function getNbextchan() {
    const fromConfig = Number(window.MUREPLAY_NBEXTCHAN);
    if (Number.isFinite(fromConfig) && fromConfig > 0) return fromConfig;
    return 1000;
  }

  /**
   * @param {Event} event
   */
  function onGridChange(event) {
    state.currentGrid =
      Number(/** @type {HTMLSelectElement} */ (event.target).value) || 0;
    fillMuSelect();
    rebuildFilteredReplayGroups();
    resetReplayForCurrentMu();
  }

  /**
   * @param {Event} event
   */
  function onMuChange(event) {
    state.currentMu =
      Number(/** @type {HTMLSelectElement} */ (event.target).value) || 0;
    rebuildFilteredReplayGroups();
    resetReplayForCurrentMu();
  }

  /**
   * @param {"prev" | "next"} direction
   */
  function goToMu(direction) {
    const mus = musForGrid(state.currentGrid);
    if (!mus.length) return;
    const current = state.currentMu ?? mus[0];
    const idx = mus.indexOf(current);
    const offset = direction === "prev" ? -1 : 1;
    let next = current;
    for (let i = 1; i <= mus.length; i++) {
      const candidate = mus[(idx + offset * i + mus.length * i) % mus.length];
      const uid = state.muUids[candidate] || "";
      const mark = state.muMarks?.[uid];
      if (!mark || mark === "flagged") {
        next = candidate;
        break;
      }
    }
    if (next === current) return;
    state.currentMu = next;
    fillMuSelect(next);
    rebuildFilteredReplayGroups();
    resetReplayForCurrentMu();
  }

  /**
   * @param {string} action
   */
  function adjustReplayView(action) {
    const total = pulseForCurrentMu().length;
    if (!total) return;
    const view =
      state.replayView && state.replayView.end > state.replayView.start
        ? state.replayView
        : { start: 0, end: total };

    const span = Math.max(1, view.end - view.start);
    const center = view.start + span / 2;
    let nextSpan = span;
    let nextStart = view.start;
    let nextEnd = view.end;

    if (action === "zoom_in") {
      nextSpan = Math.max(10, Math.round(span * 0.8));
    } else if (action === "zoom_out") {
      nextSpan = Math.min(total, Math.round(span * 1.5));
    } else if (action === "scroll_left") {
      const step = Math.max(1, Math.round(span * 0.05));
      nextStart = view.start - step;
      nextEnd = view.end - step;
    } else if (action === "scroll_right") {
      const step = Math.max(1, Math.round(span * 0.05));
      nextStart = view.start + step;
      nextEnd = view.end + step;
    }

    if (action === "zoom_in" || action === "zoom_out") {
      nextStart = Math.round(center - nextSpan / 2);
      nextEnd = Math.round(center + nextSpan / 2);
    }

    if (nextStart < 0) {
      nextEnd -= nextStart;
      nextStart = 0;
    }
    if (nextEnd > total) {
      const overflow = nextEnd - total;
      nextStart = Math.max(0, nextStart - overflow);
      nextEnd = total;
    }
    if (nextEnd <= nextStart) {
      nextEnd = Math.min(total, nextStart + 1);
    }
    state.replayView = { start: nextStart, end: nextEnd };
    renderAll();
  }

  /**
   * @param {Event} event
   */
  function onTimelineChange(event) {
    const pos =
      Number(/** @type {HTMLInputElement} */ (event.target).value) || 0;
    void seekReplayPosition(pos);
  }

  /**
   * @param {number} delta
   */
  function moveStep(delta) {
    const groups = getActiveReplayGroups();
    if (!groups.length) return;
    const target = clamp(state.replayPosition + delta, 0, groups.length);
    void seekReplayPosition(target);
  }

  function togglePlay() {
    const groups = getActiveReplayGroups();
    if (!groups.length) return;
    if (state.isPlaying) {
      stopPlay();
      return;
    }
    state.isPlaying = true;
    els.playPauseBtn.textContent = "\u23F8";
    state.playTimer = window.setInterval(() => {
      // A step that replays update_filter takes longer than this interval, so
      // skip the tick rather than stacking a second seek on top of it.
      if (seeking) return;
      const active = getActiveReplayGroups();
      if (state.replayPosition >= active.length) {
        stopPlay();
        return;
      }
      void seekReplayPosition(state.replayPosition + 1);
    }, 700);
  }

  function stopPlay() {
    state.isPlaying = false;
    els.playPauseBtn.textContent = "\u25B6";
    if (state.playTimer) {
      window.clearInterval(state.playTimer);
      state.playTimer = null;
    }
  }

  /** True while {@link runSeek} is awaiting a step. */
  let seeking = false;
  /**
   * Newest target requested while a seek was in flight, if any.
   * @type {number | null}
   */
  let pendingSeek = null;

  /**
   * Move the replay to `targetPos`, one seek at a time.
   *
   * Seeking is asynchronous because an `update_filter` step re-runs the filter
   * on the BIDS EMG server-side, which takes over a second on a normal
   * recording. Both callers can fire faster than that — the play timer every
   * 700 ms, the slider on every event of a drag — and two overlapping runs
   * each read the same `replayPosition`, both clear the
   * `target === state.replayPosition` guard, and both apply the same group:
   * the step is recomputed twice, two backups are pushed for it, and the
   * position each run then advances leaves the backup stack out of step with
   * the timeline. So a request that arrives mid-seek parks its target here
   * instead, and the run in flight picks up the newest one when it finishes.
   * Parking only the newest is what makes a drag cheap: the steps scrubbed
   * past are dropped, not queued.
   *
   * @param {number} targetPos
   */
  async function seekReplayPosition(targetPos) {
    if (seeking) {
      pendingSeek = targetPos;
      return;
    }
    seeking = true;
    try {
      /** @type {number | null} */
      let target = targetPos;
      while (target !== null) {
        const ok = await runSeek(target);
        if (!ok) break;
        target = pendingSeek;
        pendingSeek = null;
      }
    } finally {
      seeking = false;
      pendingSeek = null;
    }
  }

  /**
   * Apply or undo groups until the replay sits at `targetPos`.
   *
   * @param {number} targetPos
   * @returns {Promise<boolean>} `false` when a step failed, so the caller stops
   *   instead of running whatever was queued behind it.
   */
  async function runSeek(targetPos) {
    const groups = getActiveReplayGroups();
    const target = clamp(targetPos, 0, groups.length);
    if (target === state.replayPosition) {
      updateTimelineUi();
      updateStepDetailUi();
      renderAll();
      return true;
    }
    try {
      while (state.replayPosition < target) {
        await applyGroupForward(state.replayPosition);
        state.replayPosition += 1;
      }
      while (state.replayPosition > target) {
        undoGroupBackward(state.replayPosition - 1);
        state.replayPosition -= 1;
      }
      updateTimelineUi();
      updateStepDetailUi();
      renderAll();
      return true;
    } catch (err) {
      app.setEditStatus(
        `Replay failed at step ${state.replayPosition}: ${err instanceof Error ? err.message : err}`,
      );
      stopPlay();
      return false;
    }
  }

  function applyTimelineStep() {
    updateTimelineUi();
    updateStepDetailUi();
    renderAll();
  }

  function updateStepDetailUi() {
    const step = currentStep();
    if (!step) return;
    if (step.muIdx >= 0 && step.muIdx < state.distimes.length) {
      const grid = state.muGridIndex[step.muIdx] || 0;
      state.currentGrid = grid;
      fillGridSelect();
      fillMuSelect(step.muIdx);
    }
  }

  /**
   * @param {number} groupIdx
   */
  async function applyGroupForward(groupIdx) {
    const group = getActiveReplayGroups()[groupIdx];
    if (!group) return;
    for (const stepIdx of group.indices) {
      await applyStepForward(stepIdx);
    }
    app.setEditStatus(
      `Applied replay step ${groupIdx + 1}/${getActiveReplayGroups().length}: ${group.type}`,
    );
  }

  /**
   * @param {number} groupIdx
   */
  function undoGroupBackward(groupIdx) {
    const group = getActiveReplayGroups()[groupIdx];
    if (!group) return;
    for (let i = group.indices.length - 1; i >= 0; i -= 1) {
      undoStepBackward(group.indices[i]);
    }
    app.setEditStatus(
      `Reverted replay step ${groupIdx + 1}/${getActiveReplayGroups().length}: ${group.type}`,
    );
  }

  /**
   * @param {number} stepIdx
   */
  async function applyStepForward(stepIdx) {
    const step = state.history[stepIdx];
    if (!step) return;
    const muIdx = resolveStepMuIndex(step);
    if (muIdx < 0 || muIdx >= state.distimes.length) return;

    const backup = {
      stepIdx,
      muIdx,
      distimes: [...(state.distimes[muIdx] || [])],
      pulseTrain: [...(state.pulseTrains[muIdx] || [])],
      artifactTimes: [...(state.artifactTimes?.[muIdx] || [])],
    };
    state.replayBackups.push(backup);

    const stepType = String(step.type || "").toLowerCase();
    if (stepType === "update_filter") {
      const pulse = state.pulseTrains[muIdx] || pulseForCurrentMu();
      const payload = {
        mu_index: muIdx,
        distimes: state.distimes,
        pulse_train: pulse,
        bids_root: getBidsRoot(),
        entity_label: getEntityLabel(),
        grid_index: state.muGridIndex[muIdx] || 0,
        mu_grid_index: state.muGridIndex,
        view_start: step.viewStart ?? 0,
        view_end: step.viewEnd ?? pulse.length,
        nbextchan: getNbextchan(),
        use_peeloff: step.usePeeloff ?? false,
        lock_spikes: step.lockSpikes ?? false,
        artifact_times: state.artifactTimes?.[muIdx] || [],
        artifact_regions: state.artifactRegions || [],
      };
      try {
        const out = await api.updateFilter(payload);
        if (Array.isArray(out.distimes))
          state.distimes[muIdx] = out.distimes
            .map((n) => Number(n))
            .filter((n) => Number.isFinite(n));
        if (Array.isArray(out.pulse_train))
          state.pulseTrains[muIdx] = out.pulse_train.map((n) => Number(n) || 0);
      } catch (err) {
        app.setEditStatus(
          `update_filter step fallback (${err instanceof Error ? err.message : err})`,
        );
        state.distimes[muIdx] = applyLoggedDiffForward(
          state.distimes[muIdx],
          step,
        );
      }
    } else if (stepType === "add_artifact") {
      const added = Array.isArray(step.artifactsAdded)
        ? step.artifactsAdded
        : [];
      if (!state.artifactTimes) state.artifactTimes = [];
      const set = new Set((state.artifactTimes[muIdx] || []).map(Number));
      added.forEach((n) => set.add(Number(n)));
      state.artifactTimes[muIdx] = [...set]
        .filter((n) => Number.isFinite(n) && n >= 0)
        .sort((a, b) => a - b);
    } else if (stepType === "delete_artifact") {
      const removed = Array.isArray(step.artifactsRemoved)
        ? step.artifactsRemoved
        : [];
      if (!state.artifactTimes) state.artifactTimes = [];
      const set = new Set((state.artifactTimes[muIdx] || []).map(Number));
      removed.forEach((n) => set.delete(Number(n)));
      state.artifactTimes[muIdx] = [...set]
        .filter((n) => Number.isFinite(n) && n >= 0)
        .sort((a, b) => a - b);
    } else {
      state.distimes[muIdx] = applyLoggedDiffForward(
        state.distimes[muIdx],
        step,
      );
    }

    const grid = state.muGridIndex[muIdx] || 0;
    state.currentGrid = grid;
    fillGridSelect();
    fillMuSelect(muIdx);
  }

  /**
   * @param {number} stepIdx
   */
  function undoStepBackward(stepIdx) {
    const step = state.history[stepIdx];
    if (!step) return;
    const backup = state.replayBackups.pop();
    if (!backup || backup.stepIdx !== stepIdx) {
      const muIdx = resolveStepMuIndex(step);
      if (muIdx >= 0 && muIdx < state.distimes.length) {
        const stepType = String(step?.type || "").toLowerCase();
        if (stepType === "add_artifact") {
          const added = Array.isArray(step.artifactsAdded)
            ? step.artifactsAdded
            : [];
          if (!state.artifactTimes) state.artifactTimes = [];
          const set = new Set((state.artifactTimes[muIdx] || []).map(Number));
          added.forEach((n) => set.delete(Number(n)));
          state.artifactTimes[muIdx] = [...set]
            .filter((n) => Number.isFinite(n) && n >= 0)
            .sort((a, b) => a - b);
        } else if (stepType === "delete_artifact") {
          const removed = Array.isArray(step.artifactsRemoved)
            ? step.artifactsRemoved
            : [];
          if (!state.artifactTimes) state.artifactTimes = [];
          const set = new Set((state.artifactTimes[muIdx] || []).map(Number));
          removed.forEach((n) => set.add(Number(n)));
          state.artifactTimes[muIdx] = [...set]
            .filter((n) => Number.isFinite(n) && n >= 0)
            .sort((a, b) => a - b);
        } else {
          state.distimes[muIdx] = applyLoggedDiffBackward(
            state.distimes[muIdx],
            step,
          );
        }
      }
      return;
    }
    state.distimes[backup.muIdx] = backup.distimes;
    state.pulseTrains[backup.muIdx] = backup.pulseTrain;
    if (Array.isArray(backup.artifactTimes)) {
      if (!state.artifactTimes) state.artifactTimes = [];
      state.artifactTimes[backup.muIdx] = backup.artifactTimes;
    }
    const grid = state.muGridIndex[backup.muIdx] || 0;
    state.currentGrid = grid;
    fillGridSelect();
    fillMuSelect(backup.muIdx);
  }

  /**
   * @param {EditLogEntry} step
   * @returns {number}
   */
  function resolveStepMuIndex(step) {
    if (Number.isFinite(step?.muIdx) && step.muIdx >= 0) return step.muIdx;
    if (step?.muUid) {
      const idx = state.muUids.indexOf(step.muUid);
      if (idx >= 0) return idx;
    }
    return -1;
  }

  /**
   * @param {EditLogEntry[]} steps
   * @returns {EditLogEntry | null}
   */
  function mergeStepsForDisplay(steps) {
    if (!steps.length) return null;
    if (steps.length === 1) return steps[0];
    const first = steps[0];
    const last = steps[steps.length - 1];
    const muSet = new Set(steps.map((s) => stepMuKey(s)));
    const starts = steps.map((s) => s.viewStart).filter((v) => v != null);
    const ends = steps.map((s) => s.viewEnd).filter((v) => v != null);
    const spikesAdded = [
      ...new Set(
        steps.flatMap((s) =>
          Array.isArray(s.spikesAdded) ? s.spikesAdded : [],
        ),
      ),
    ];
    const spikesRemoved = [
      ...new Set(
        steps.flatMap((s) =>
          Array.isArray(s.spikesRemoved) ? s.spikesRemoved : [],
        ),
      ),
    ];
    return {
      ...last,
      type: "spike_edits",
      timestamp: `${first.timestamp} -> ${last.timestamp}`,
      viewStart: starts.length ? Math.min(...starts) : null,
      viewEnd: ends.length ? Math.max(...ends) : null,
      spikesAdded,
      spikesRemoved,
      muIdx: muSet.size === 1 ? resolveStepMuIndex(first) : -1,
      muUid: muSet.size === 1 ? first.muUid : "",
      groupedCount: steps.length,
    };
  }

  function rebuildMuMarks() {
    /** @type {Record<string, string>} */
    const marks = {};
    for (const step of state.history) {
      const type = String(step?.type || "").toLowerCase();
      if (type === "flag_mu" && step.muUid) {
        marks[step.muUid] = "flagged";
      } else if (type === "duplicate_mu") {
        if (step.muUid) marks[step.muUid] = marks[step.muUid] || "duplicate";
        const sourceUid = step.raw?.source_mu_uid;
        if (sourceUid) marks[sourceUid] = marks[sourceUid] || "duplicate";
      } else if (type === "remove_duplicates" || type === "remove_flagged") {
        const removedUids = step.raw?.removed_mu_uids;
        if (Array.isArray(removedUids))
          removedUids.forEach((uid) => {
            marks[String(uid)] = "removed";
          });
      }
    }
    state.muMarks = marks;
    const liveUidSet = new Set(state.muUids);
    state.muGhostUids = Object.keys(marks).filter(
      (uid) => !liveUidSet.has(uid),
    );
  }

  function rebuildReplayGroups() {
    /** @type {ReplayGroup[]} */
    const groups = [];
    let i = 0;
    while (i < state.history.length) {
      const step = state.history[i];
      if (!isSpikeEditStep(step)) {
        groups.push({
          indices: [i],
          type: String(step.type || "unknown"),
          displayStep: step,
        });
        i += 1;
        continue;
      }
      const key = stepMuKey(step);
      const indices = [i];
      let j = i + 1;
      while (j < state.history.length) {
        const next = state.history[j];
        if (!isSpikeEditStep(next)) break;
        if (stepMuKey(next) !== key) break;
        indices.push(j);
        j += 1;
      }
      const grouped = indices.map((idx) => state.history[idx]);
      groups.push({
        indices,
        type: "spike_edits",
        displayStep: mergeStepsForDisplay(grouped),
      });
      i = j;
    }
    state.replayGroups = groups;
    rebuildMuMarks();
    rebuildFilteredReplayGroups();
  }

  function rebuildFilteredReplayGroups() {
    const ghostUidSet = new Set(state.muGhostUids || []);
    state.filteredReplayGroups = state.replayGroups.filter((group) => {
      const uid = group.displayStep?.muUid || "";
      if (uid && ghostUidSet.has(uid)) return false;
      return group.indices.some(
        (idx) => resolveStepMuIndex(state.history[idx]) === state.currentMu,
      );
    });
  }

  /**
   * @returns {ReplayGroup[]}
   */
  function getActiveReplayGroups() {
    return state.filteredReplayGroups;
  }

  function initializeReplayFromLoadedData() {
    state.replayBackups = [];
    state.replayPosition = 0;
    state.replayView = null;
    if (state.loadedFromDecomp) {
      state.replayBaseDistimes = state.distimes.map((row) => [...row]);
      state.replayBasePulseTrains = state.pulseTrains.map((row) => [...row]);
      state.replayBaseArtifactTimes = (state.artifactTimes || []).map((row) => [
        ...(row || []),
      ]);
      state.distimes = state.replayBaseDistimes.map((row) => [...row]);
      state.pulseTrains = state.replayBasePulseTrains.map((row) => [...row]);
      state.artifactTimes = state.replayBaseArtifactTimes.map((row) => [
        ...row,
      ]);
      return;
    }
    state.replayBaseDistimes = state.distimes.map((row) => [...row]);
    for (let i = state.history.length - 1; i >= 0; i -= 1) {
      const step = state.history[i];
      const muIdx = resolveStepMuIndex(step);
      if (muIdx < 0 || muIdx >= state.replayBaseDistimes.length) continue;
      state.replayBaseDistimes[muIdx] = applyLoggedDiffBackward(
        state.replayBaseDistimes[muIdx],
        step,
      );
    }
    state.replayBasePulseTrains = state.pulseTrains.map((row) => [...row]);
    state.replayBaseArtifactTimes = (state.artifactTimes || []).map((row) => [
      ...(row || []),
    ]);
    for (let i = state.history.length - 1; i >= 0; i -= 1) {
      const step = state.history[i];
      const artType = String(step?.type || "").toLowerCase();
      if (artType !== "add_artifact" && artType !== "delete_artifact") continue;
      const muIdx = resolveStepMuIndex(step);
      if (muIdx < 0 || muIdx >= state.replayBaseArtifactTimes.length) continue;
      const set = new Set(
        (state.replayBaseArtifactTimes[muIdx] || []).map(Number),
      );
      if (artType === "add_artifact") {
        (Array.isArray(step.artifactsAdded) ? step.artifactsAdded : []).forEach(
          (n) => set.delete(Number(n)),
        );
      } else {
        (Array.isArray(step.artifactsRemoved)
          ? step.artifactsRemoved
          : []
        ).forEach((n) => set.add(Number(n)));
      }
      state.replayBaseArtifactTimes[muIdx] = [...set]
        .filter((n) => Number.isFinite(n) && n >= 0)
        .sort((a, b) => a - b);
    }
    state.distimes = state.replayBaseDistimes.map((row) => [...row]);
    state.pulseTrains = state.replayBasePulseTrains.map((row) => [...row]);
    state.artifactTimes = state.replayBaseArtifactTimes.map((row) => [...row]);
  }

  function resetReplayForCurrentMu() {
    state.replayBackups = [];
    state.replayPosition = 0;
    state.replayView = null;
    if (state.replayBaseDistimes.length)
      state.distimes = state.replayBaseDistimes.map((row) => [...row]);
    if (state.replayBasePulseTrains.length)
      state.pulseTrains = state.replayBasePulseTrains.map((row) => [...row]);
    if (state.replayBaseArtifactTimes?.length)
      state.artifactTimes = state.replayBaseArtifactTimes.map((row) => [
        ...row,
      ]);
    updateTimelineUi();
    applyTimelineStep();
  }

  function fillGridSelect() {
    els.editMuGridSelect.innerHTML = "";
    const labels = state.gridNames.length ? state.gridNames : ["Grid 1"];
    labels.forEach((name, idx) => {
      const option = document.createElement("option");
      option.value = String(idx);
      option.textContent = `Grid ${idx + 1}${name ? ` \u2022 ${name}` : ""}`;
      els.editMuGridSelect.appendChild(option);
    });
    els.editMuGridSelect.value = String(state.currentGrid);
  }

  /**
   * @param {number | null} [forceMu]
   */
  function fillMuSelect(forceMu = null) {
    const mus = musForGrid(state.currentGrid);
    els.editMuSelect.innerHTML = "";
    if (!mus.length) {
      const option = document.createElement("option");
      option.value = "0";
      option.textContent = "No MUs";
      els.editMuSelect.appendChild(option);
      state.currentMu = 0;
      return;
    }
    mus.forEach((muIdx) => {
      const option = document.createElement("option");
      option.value = String(muIdx);
      const uid = state.muUids[muIdx] || "";
      const mark = state.muMarks?.[uid];
      const prefix =
        mark === "flagged"
          ? "\u2715 "
          : mark === "duplicate"
            ? "\u2295 "
            : mark === "removed"
              ? "\u2297 "
              : "";
      option.textContent = `${prefix}MU ${muIdx + 1}`;
      if (mark && mark !== "flagged") option.disabled = true;
      els.editMuSelect.appendChild(option);
    });
    const ghostsForGrid = (state.muGhostUids || []).filter((uid) => {
      const m = uid.match(/^g(\d+)_/);
      return m && Number(m[1]) === state.currentGrid;
    });
    ghostsForGrid.forEach((uid) => {
      const option = document.createElement("option");
      option.disabled = true;
      option.value = "";
      const mark = state.muMarks[uid];
      const prefix =
        mark === "flagged"
          ? "\u2715"
          : mark === "duplicate"
            ? "\u2295"
            : mark === "removed"
              ? "\u2297"
              : "\u2014";
      option.textContent = `${prefix} ${uid} (removed)`;
      els.editMuSelect.appendChild(option);
    });
    if (forceMu != null && mus.includes(forceMu)) state.currentMu = forceMu;
    else if (!mus.includes(state.currentMu)) state.currentMu = mus[0];
    const currentUid = state.muUids[state.currentMu] || "";
    if (
      currentUid &&
      state.muMarks?.[currentUid] &&
      state.muMarks[currentUid] !== "flagged"
    ) {
      const first = mus.find((m) => {
        const u = state.muUids[m] || "";
        const mk = state.muMarks?.[u];
        return !mk || mk === "flagged";
      });
      if (first != null) state.currentMu = first;
    }
    els.editMuSelect.value = String(state.currentMu);
  }

  function updateTimelineUi() {
    const total = getActiveReplayGroups().length;
    const max = Math.max(0, total);
    els.timelineSlider.max = String(max);
    els.timelineSlider.value = String(clamp(state.replayPosition, 0, max));
    els.timelineSlider.disabled = total === 0;
    els.prevStepBtn.disabled = total === 0 || state.replayPosition <= 0;
    els.nextStepBtn.disabled = total === 0 || state.replayPosition >= total;
    els.playPauseBtn.disabled = total === 0;
    if (els.timelineCounter)
      els.timelineCounter.textContent = `Step ${state.replayPosition} / ${total}`;
    updateTimelineTrackColors();
  }

  function updateTimelineTrackColors() {
    const groups = getActiveReplayGroups();
    const total = groups.length;
    if (!els.timelineSlider) return;
    if (!total) {
      els.timelineSlider.style.setProperty("--timeline-gradient", "#3a3a3a");
      return;
    }
    const parts = [];
    for (let i = 0; i < total; i += 1) {
      const start = (i / total) * 100;
      const end = ((i + 1) / total) * 100;
      const colorKind = getGroupColorKindForDisplayedMu(groups[i]);
      if (colorKind === "split_add_remove") {
        const mid = (start + end) / 2;
        parts.push(
          `#4ce38a ${start}%`,
          `#4ce38a ${mid}%`,
          `#ff7a7a ${mid}%`,
          `#ff7a7a ${end}%`,
        );
      } else if (colorKind === "add") {
        parts.push(`#4ce38a ${start}%`, `#4ce38a ${end}%`);
      } else if (colorKind === "remove") {
        parts.push(`#ff7a7a ${start}%`, `#ff7a7a ${end}%`);
      } else if (colorKind === "update_filter") {
        parts.push(`#3776ab ${start}%`, `#3776ab ${end}%`);
      } else if (colorKind === "artifact") {
        parts.push(`#ff8c66 ${start}%`, `#ff8c66 ${end}%`);
      } else {
        parts.push(`#3a3a3a ${start}%`, `#3a3a3a ${end}%`);
      }
    }
    els.timelineSlider.style.setProperty(
      "--timeline-gradient",
      `linear-gradient(to right, ${parts.join(", ")})`,
    );
  }

  /**
   * @param {ReplayGroup} group
   * @returns {"neutral" | "split_add_remove" | "add" | "remove" | "update_filter" | "artifact"}
   */
  function getGroupColorKindForDisplayedMu(group) {
    if (!group?.indices?.length) return "neutral";
    const relevant = group.indices
      .map((idx) => state.history[idx])
      .filter((step) => resolveStepMuIndex(step) === state.currentMu);
    if (!relevant.length) return "neutral";
    if (
      relevant.some(
        (step) => String(step?.type || "").toLowerCase() === "update_filter",
      )
    )
      return "update_filter";
    if (
      relevant.some((step) => {
        const t = String(step?.type || "").toLowerCase();
        return t === "add_artifact" || t === "delete_artifact";
      })
    )
      return "artifact";
    const hasAdd = relevant.some(
      (step) => String(step?.type || "").toLowerCase() === "add_spikes",
    );
    const hasRemove = relevant.some((step) => {
      const t = String(step?.type || "").toLowerCase();
      return (
        t === "delete_spikes" || t === "delete_dr" || t === "remove_outliers"
      );
    });
    if (hasAdd && hasRemove) return "split_add_remove";
    if (hasAdd) return "add";
    if (hasRemove) return "remove";
    return "neutral";
  }

  function pulseForCurrentMu() {
    const pulse = state.pulseTrains[state.currentMu];
    if (Array.isArray(pulse) && pulse.length) return pulse;
    const spikes = distimesForCurrentMu();
    if (!spikes.length) return [];
    const n = extent(spikes).max + 1;
    const synthetic = new Array(n).fill(0);
    spikes.forEach((s) => {
      if (s >= 0 && s < synthetic.length) synthetic[s] = 1;
    });
    return synthetic;
  }

  function distimesForCurrentMu() {
    const row = state.distimes[state.currentMu];
    return Array.isArray(row) ? row : [];
  }

  function artifactTimesForCurrentMu() {
    return state.artifactTimes?.[state.currentMu] || [];
  }

  function currentStep() {
    const groups = getActiveReplayGroups();
    if (!groups.length || state.replayPosition <= 0) return null;
    const idx = clamp(state.replayPosition - 1, 0, groups.length - 1);
    return groups[idx]?.displayStep || null;
  }

  /**
   * @param {EditLogEntry | null} step
   * @returns {boolean}
   */
  function isCurrentMuStep(step) {
    return !!step && step.muIdx === state.currentMu;
  }

  /**
   * @param {number} gridIdx
   * @returns {number[]}
   */
  function musForGrid(gridIdx) {
    /** @type {number[]} */
    const mus = [];
    state.muGridIndex.forEach((g, muIdx) => {
      if ((Number(g) || 0) === gridIdx) mus.push(muIdx);
    });
    return mus;
  }

  function firstGridWithMu() {
    const grids = new Set(state.muGridIndex.map((v) => Number(v) || 0));
    for (const grid of grids) {
      if (musForGrid(grid).length) return grid;
    }
    return 0;
  }

  return {
    setRenderAll,
    onGridChange,
    onMuChange,
    goToMu,
    adjustReplayView,
    onTimelineChange,
    moveStep,
    togglePlay,
    stopPlay,
    updateTimelineUi,
    applyTimelineStep,
    initializeReplayFromLoadedData,
    rebuildReplayGroups,
    rebuildFilteredReplayGroups,
    resetReplayForCurrentMu,
    fillGridSelect,
    fillMuSelect,
    firstGridWithMu,
    musForGrid,
    getActiveReplayGroups,
    currentStep,
    isCurrentMuStep,
    pulseForCurrentMu,
    distimesForCurrentMu,
    artifactTimesForCurrentMu,
  };
}
