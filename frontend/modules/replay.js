export function createReplayController({ state, els, postJson, setEditStatus, getBidsRoot, getEntityLabel, getNbextchan, clamp }) {
  let renderAll = () => {};

  function setRenderAll(fn) {
    renderAll = typeof fn === "function" ? fn : () => {};
  }

  function onGridChange(event) {
    state.currentGrid = Number(event.target.value) || 0;
    fillMuSelect();
    rebuildFilteredReplayGroups();
    resetReplayForCurrentMu();
  }

  function onMuChange(event) {
    state.currentMu = Number(event.target.value) || 0;
    rebuildFilteredReplayGroups();
    resetReplayForCurrentMu();
  }

  function goToMu(direction) {
    const mus = musForGrid(state.currentGrid);
    if (!mus.length) return;
    const current = state.currentMu ?? mus[0];
    const idx = mus.indexOf(current);
    const offset = direction === "prev" ? -1 : 1;
    const next = mus[(idx + offset + mus.length) % mus.length];
    state.currentMu = next;
    fillMuSelect(next);
    rebuildFilteredReplayGroups();
    resetReplayForCurrentMu();
  }

  function adjustReplayView(action) {
    const total = pulseForCurrentMu().length;
    if (!total) return;
    const view = state.replayView && state.replayView.end > state.replayView.start
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

  function onTimelineChange(event) {
    const pos = Number(event.target.value) || 0;
    void seekReplayPosition(pos);
  }

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
    els.playPauseBtn.textContent = "⏸";
    state.playTimer = window.setInterval(() => {
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
    els.playPauseBtn.textContent = "▶";
    if (state.playTimer) {
      window.clearInterval(state.playTimer);
      state.playTimer = null;
    }
  }

  async function seekReplayPosition(targetPos) {
    const groups = getActiveReplayGroups();
    const target = clamp(targetPos, 0, groups.length);
    if (target === state.replayPosition) {
      updateTimelineUi();
      updateStepDetailUi();
      renderAll();
      return;
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
    } catch (err) {
      setEditStatus(`Replay failed at step ${state.replayPosition}: ${err.message}`);
      stopPlay();
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

  async function applyGroupForward(groupIdx) {
    const group = getActiveReplayGroups()[groupIdx];
    if (!group) return;
    for (const stepIdx of group.indices) {
      await applyStepForward(stepIdx);
    }
    setEditStatus(`Applied replay step ${groupIdx + 1}/${getActiveReplayGroups().length}: ${group.type}`);
  }

  function undoGroupBackward(groupIdx) {
    const group = getActiveReplayGroups()[groupIdx];
    if (!group) return;
    for (let i = group.indices.length - 1; i >= 0; i -= 1) {
      undoStepBackward(group.indices[i]);
    }
    setEditStatus(`Reverted replay step ${groupIdx + 1}/${getActiveReplayGroups().length}: ${group.type}`);
  }

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
      };
      try {
        const out = await postJson("/api/edit/update-filter", payload);
        if (Array.isArray(out.distimes)) {
          state.distimes[muIdx] = out.distimes.map((n) => Number(n)).filter((n) => Number.isFinite(n));
        }
        if (Array.isArray(out.pulse_train)) {
          state.pulseTrains[muIdx] = out.pulse_train.map((n) => Number(n) || 0);
        }
      } catch (err) {
        setEditStatus(`update_filter step fallback (${err.message})`);
        applyLoggedDiffForward(muIdx, step);
      }
    } else {
      applyLoggedDiffForward(muIdx, step);
    }

    const grid = state.muGridIndex[muIdx] || 0;
    state.currentGrid = grid;
    fillGridSelect();
    fillMuSelect(muIdx);
  }

  function undoStepBackward(stepIdx) {
    const step = state.history[stepIdx];
    if (!step) return;
    const backup = state.replayBackups.pop();
    if (!backup || backup.stepIdx !== stepIdx) {
      const muIdx = resolveStepMuIndex(step);
      if (muIdx >= 0 && muIdx < state.distimes.length) {
        applyLoggedDiffBackward(muIdx, step);
      }
      return;
    }
    state.distimes[backup.muIdx] = backup.distimes;
    state.pulseTrains[backup.muIdx] = backup.pulseTrain;
    const grid = state.muGridIndex[backup.muIdx] || 0;
    state.currentGrid = grid;
    fillGridSelect();
    fillMuSelect(backup.muIdx);
  }

  function applyLoggedDiffForward(muIdx, step) {
    const current = new Set((state.distimes[muIdx] || []).map((n) => Number(n)));
    const added = Array.isArray(step.spikesAdded) ? step.spikesAdded : [];
    const removed = Array.isArray(step.spikesRemoved) ? step.spikesRemoved : [];
    removed.forEach((n) => current.delete(Number(n)));
    added.forEach((n) => current.add(Number(n)));
    state.distimes[muIdx] = [...current].filter((n) => Number.isFinite(n) && n >= 0).sort((a, b) => a - b);
  }

  function applyLoggedDiffBackward(muIdx, step) {
    const current = new Set((state.distimes[muIdx] || []).map((n) => Number(n)));
    const added = Array.isArray(step.spikesAdded) ? step.spikesAdded : [];
    const removed = Array.isArray(step.spikesRemoved) ? step.spikesRemoved : [];
    added.forEach((n) => current.delete(Number(n)));
    removed.forEach((n) => current.add(Number(n)));
    state.distimes[muIdx] = [...current].filter((n) => Number.isFinite(n) && n >= 0).sort((a, b) => a - b);
  }

  function resolveStepMuIndex(step) {
    if (Number.isFinite(step?.muIdx) && step.muIdx >= 0) return step.muIdx;
    if (step?.muUid) {
      const idx = state.muUids.indexOf(step.muUid);
      if (idx >= 0) return idx;
    }
    return -1;
  }

  function isSpikeEditStep(step) {
    const type = String(step?.type || "").toLowerCase();
    return type === "add_spikes" || type === "delete_spikes" || type === "delete_dr" || type === "remove_outliers";
  }

  function stepMuKey(step) {
    if (step?.muUid) return `uid:${step.muUid}`;
    if (Number.isFinite(step?.muIdx) && step.muIdx >= 0) return `idx:${step.muIdx}`;
    return "unknown";
  }

  function mergeStepsForDisplay(steps) {
    if (!steps.length) return null;
    if (steps.length === 1) return steps[0];
    const first = steps[0];
    const last = steps[steps.length - 1];
    const muSet = new Set(steps.map((s) => stepMuKey(s)));
    const starts = steps.map((s) => s.viewStart).filter((v) => Number.isFinite(v));
    const ends = steps.map((s) => s.viewEnd).filter((v) => Number.isFinite(v));
    const spikesAdded = [...new Set(steps.flatMap((s) => (Array.isArray(s.spikesAdded) ? s.spikesAdded : [])))];
    const spikesRemoved = [...new Set(steps.flatMap((s) => (Array.isArray(s.spikesRemoved) ? s.spikesRemoved : [])))];
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

  function rebuildReplayGroups() {
    // Collapse contiguous spike edits on the same MU to keep timeline navigation usable.
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
    rebuildFilteredReplayGroups();
  }

  function rebuildFilteredReplayGroups() {
    state.filteredReplayGroups = state.replayGroups.filter((group) =>
      group.indices.some((idx) => resolveStepMuIndex(state.history[idx]) === state.currentMu),
    );
  }

  function getActiveReplayGroups() {
    return state.filteredReplayGroups;
  }

  function initializeReplayFromLoadedData() {
    state.replayBackups = [];
    state.replayPosition = 0;
    state.replayView = null;
    if (state.loadedFromDecomp) {
      // Decomp sources are already pre-edit baseline.
      state.replayBaseDistimes = state.distimes.map((row) => [...row]);
      state.replayBasePulseTrains = state.pulseTrains.map((row) => [...row]);
      state.distimes = state.replayBaseDistimes.map((row) => [...row]);
      state.pulseTrains = state.replayBasePulseTrains.map((row) => [...row]);
      return;
    }
    // Edited sources are end-state; rewind log diffs to reconstruct baseline.
    state.replayBaseDistimes = state.distimes.map((row) => [...row]);
    for (let i = state.history.length - 1; i >= 0; i -= 1) {
      const step = state.history[i];
      const muIdx = resolveStepMuIndex(step);
      if (muIdx < 0 || muIdx >= state.replayBaseDistimes.length) continue;
      const set = new Set((state.replayBaseDistimes[muIdx] || []).map((n) => Number(n)));
      const added = Array.isArray(step.spikesAdded) ? step.spikesAdded : [];
      const removed = Array.isArray(step.spikesRemoved) ? step.spikesRemoved : [];
      added.forEach((n) => set.delete(Number(n)));
      removed.forEach((n) => set.add(Number(n)));
      state.replayBaseDistimes[muIdx] = [...set]
        .filter((n) => Number.isFinite(n) && n >= 0)
        .sort((a, b) => a - b);
    }
    state.replayBasePulseTrains = state.pulseTrains.map((row) => [...row]);
    state.distimes = state.replayBaseDistimes.map((row) => [...row]);
    state.pulseTrains = state.replayBasePulseTrains.map((row) => [...row]);
  }

  function resetReplayForCurrentMu() {
    state.replayBackups = [];
    state.replayPosition = 0;
    state.replayView = null;
    if (state.replayBaseDistimes.length) {
      state.distimes = state.replayBaseDistimes.map((row) => [...row]);
    }
    if (state.replayBasePulseTrains.length) {
      state.pulseTrains = state.replayBasePulseTrains.map((row) => [...row]);
    }
    updateTimelineUi();
    applyTimelineStep();
  }

  function fillGridSelect() {
    els.editMuGridSelect.innerHTML = "";
    const labels = state.gridNames.length ? state.gridNames : ["Grid 1"];
    labels.forEach((name, idx) => {
      const option = document.createElement("option");
      option.value = String(idx);
      option.textContent = `Grid ${idx + 1}${name ? ` • ${name}` : ""}`;
      els.editMuGridSelect.appendChild(option);
    });
    els.editMuGridSelect.value = String(state.currentGrid);
  }

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
      option.textContent = `MU ${muIdx + 1}`;
      els.editMuSelect.appendChild(option);
    });
    if (forceMu != null && mus.includes(forceMu)) {
      state.currentMu = forceMu;
    } else if (!mus.includes(state.currentMu)) {
      state.currentMu = mus[0];
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
        parts.push(`#4ce38a ${start}%`, `#4ce38a ${mid}%`, `#ff7a7a ${mid}%`, `#ff7a7a ${end}%`);
      } else if (colorKind === "add") {
        parts.push(`#4ce38a ${start}%`, `#4ce38a ${end}%`);
      } else if (colorKind === "remove") {
        parts.push(`#ff7a7a ${start}%`, `#ff7a7a ${end}%`);
      } else if (colorKind === "update_filter") {
        parts.push(`#3776ab ${start}%`, `#3776ab ${end}%`);
      } else {
        parts.push(`#3a3a3a ${start}%`, `#3a3a3a ${end}%`);
      }
    }

    const gradient = `linear-gradient(to right, ${parts.join(", ")})`;
    els.timelineSlider.style.setProperty("--timeline-gradient", gradient);
  }

  function getGroupColorKindForDisplayedMu(group) {
    if (!group?.indices?.length) return "neutral";
    const relevant = group.indices
      .map((idx) => state.history[idx])
      .filter((step) => resolveStepMuIndex(step) === state.currentMu);
    if (!relevant.length) return "neutral";

    const hasUpdate = relevant.some((step) => String(step?.type || "").toLowerCase() === "update_filter");
    if (hasUpdate) return "update_filter";

    const hasAdd = relevant.some((step) => String(step?.type || "").toLowerCase() === "add_spikes");
    const hasRemove = relevant.some((step) => {
      const t = String(step?.type || "").toLowerCase();
      return t === "delete_spikes" || t === "delete_dr" || t === "remove_outliers";
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
    const n = Math.max(...spikes) + 1;
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

  function currentStep() {
    const groups = getActiveReplayGroups();
    if (!groups.length || state.replayPosition <= 0) return null;
    const idx = clamp(state.replayPosition - 1, 0, groups.length - 1);
    return groups[idx]?.displayStep || null;
  }

  function isCurrentMuStep(step) {
    return !!step && step.muIdx === state.currentMu;
  }

  function musForGrid(gridIdx) {
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
    applyTimelineStep,
    currentStep,
    distimesForCurrentMu,
    fillGridSelect,
    fillMuSelect,
    firstGridWithMu,
    getActiveReplayGroups,
    initializeReplayFromLoadedData,
    isCurrentMuStep,
    moveStep,
    musForGrid,
    onGridChange,
    onMuChange,
    onTimelineChange,
    pulseForCurrentMu,
    adjustReplayView,
    rebuildReplayGroups,
    resetReplayForCurrentMu,
    goToMu,
    setRenderAll,
    stopPlay,
    togglePlay,
    updateTimelineUi,
  };
}
