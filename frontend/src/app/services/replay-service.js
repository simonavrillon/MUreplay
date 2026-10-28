/**
 * Replay service: the replay engine.
 *
 * Groups the log into timeline steps, applies and undoes them on the current
 * MU's rows, and asks the backend to refit `update_filter` steps on the BIDS
 * EMG. Every step applied forward pushes a backup, so undoing it restores the
 * rows exactly; a refit that fails falls back to the step's logged diff.
 */
import {
  applyArtifactDiffBackward,
  applyArtifactDiffForward,
  applyLoggedDiffBackward,
  applyLoggedDiffForward,
  clamp,
  inactiveMusBefore,
  isArtifactStep,
  isSpikeEditStep,
  stepMuKey,
} from "../../replay/operations.js";
import {
  popReplayBackup,
  pushReplayBackup,
  restoreReplayBase,
  setCurrentGrid,
  setCurrentMu,
  setFilteredReplayGroups,
  setMuRows,
  setPlayTimer,
  setReplayBase,
  setReplayGroups,
  setReplayPosition,
  setReplayView,
} from "../../state/actions.js";
import {
  currentStep,
  firstGridWithMu,
  getActiveReplayGroups,
  getBidsRoot,
  getEntityLabel,
  getReplayView,
  musForGrid,
  pulseForCurrentMu,
  resolveStepMuIndex,
} from "../../state/selectors.js";
import { errorMessage, handleError } from "./error-service.js";

/** @typedef {import("../../state/state.js").EditLogEntry} EditLogEntry */
/** @typedef {import("../../state/state.js").ReplayGroup} ReplayGroup */
/** @typedef {import("../context.js").ReplayService} ReplayService */

/** The filter extension MUedit2 decomposes with unless a run says otherwise. */
const DEFAULT_NBEXTCHAN = 1000;
/** Milliseconds between steps while playing. */
const PLAY_INTERVAL_MS = 700;
/**
 * Option prefixes for the marks the log puts on an MU.
 *
 * @type {Record<string, string>}
 */
const MARK_PREFIX = { flagged: "✕", duplicate: "⊕", removed: "⊗" };

/**
 * @param {import("../context.js").App} app
 * @returns {ReplayService}
 */
export function createReplayService(app) {
  const { state, els, api } = app;

  /** @type {ReplayService["onGridChange"]} */
  function onGridChange(event) {
    setCurrentGrid(
      state,
      Number(/** @type {HTMLSelectElement} */ (event.target).value) || 0,
    );
    fillMuSelect();
    rebuildFilteredReplayGroups();
    resetReplayForCurrentMu();
  }

  /** @type {ReplayService["onMuChange"]} */
  function onMuChange(event) {
    setCurrentMu(
      state,
      Number(/** @type {HTMLSelectElement} */ (event.target).value) || 0,
    );
    rebuildFilteredReplayGroups();
    resetReplayForCurrentMu();
  }

  /** @type {ReplayService["goToMu"]} */
  function goToMu(direction) {
    const mus = musForGrid(state, state.currentGrid);
    if (!mus.length) return;
    const current = state.currentMu ?? mus[0];
    const idx = mus.indexOf(current);
    const offset = direction === "prev" ? -1 : 1;
    let next = current;
    for (let i = 1; i <= mus.length; i++) {
      const candidate = mus[(idx + offset * i + mus.length * i) % mus.length];
      if (isSelectable(candidate)) {
        next = candidate;
        break;
      }
    }
    if (next === current) return;
    setCurrentMu(state, next);
    fillMuSelect(next);
    rebuildFilteredReplayGroups();
    resetReplayForCurrentMu();
  }

  /** @type {ReplayService["adjustReplayView"]} */
  function adjustReplayView(action) {
    const total = pulseForCurrentMu(state).length;
    if (!total) return;
    const view = getReplayView(state, total);
    const span = Math.max(1, view.end - view.start);
    const center = view.start + span / 2;
    let nextStart = view.start;
    let nextEnd = view.end;

    if (action === "zoom_in" || action === "zoom_out") {
      const nextSpan =
        action === "zoom_in"
          ? Math.max(10, Math.round(span * 0.8))
          : Math.min(total, Math.round(span * 1.5));
      nextStart = Math.round(center - nextSpan / 2);
      nextEnd = Math.round(center + nextSpan / 2);
    } else if (action === "scroll_left" || action === "scroll_right") {
      const step = Math.max(1, Math.round(span * 0.05));
      const shift = action === "scroll_left" ? -step : step;
      nextStart += shift;
      nextEnd += shift;
    }

    if (nextStart < 0) {
      nextEnd -= nextStart;
      nextStart = 0;
    }
    if (nextEnd > total) {
      nextStart = Math.max(0, nextStart - (nextEnd - total));
      nextEnd = total;
    }
    if (nextEnd <= nextStart) nextEnd = Math.min(total, nextStart + 1);
    setReplayView(state, { start: nextStart, end: nextEnd });
    app.renderAll();
  }

  /** @type {ReplayService["onTimelineChange"]} */
  function onTimelineChange(event) {
    const pos =
      Number(/** @type {HTMLInputElement} */ (event.target).value) || 0;
    void seekReplayPosition(pos);
  }

  /** @type {ReplayService["moveStep"]} */
  function moveStep(delta) {
    const groups = getActiveReplayGroups(state);
    if (!groups.length) return;
    void seekReplayPosition(
      clamp(state.replayPosition + delta, 0, groups.length),
    );
  }

  /** @type {ReplayService["togglePlay"]} */
  function togglePlay() {
    if (!getActiveReplayGroups(state).length) return;
    if (state.isPlaying) {
      stopPlay();
      return;
    }
    els.playPauseBtn.textContent = "⏸";
    const timer = window.setInterval(() => {
      // A step that replays update_filter takes longer than this interval, so
      // skip the tick rather than stacking a second seek on top of it.
      if (seeking) return;
      if (state.replayPosition >= getActiveReplayGroups(state).length) {
        stopPlay();
        return;
      }
      void seekReplayPosition(state.replayPosition + 1);
    }, PLAY_INTERVAL_MS);
    setPlayTimer(state, timer);
  }

  /** Stop playing, and show the play button. */
  function stopPlay() {
    els.playPauseBtn.textContent = "▶";
    if (state.playTimer) window.clearInterval(state.playTimer);
    setPlayTimer(state, null);
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
   * An `update_filter` step refits on the server, which takes over a second,
   * while the play timer and a slider drag fire faster than that. Two
   * overlapping runs would apply the same group twice and leave the backup
   * stack out of step with the timeline, so a request that arrives mid-seek
   * parks its target here and the run in flight picks up the newest one when
   * it finishes. Parking only the newest keeps a drag cheap: the steps
   * scrubbed past are dropped, not queued.
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
    const target = clamp(targetPos, 0, getActiveReplayGroups(state).length);
    try {
      while (state.replayPosition < target) {
        await applyGroupForward(state.replayPosition);
        setReplayPosition(state, state.replayPosition + 1);
      }
      while (state.replayPosition > target) {
        undoGroupBackward(state.replayPosition - 1);
        setReplayPosition(state, state.replayPosition - 1);
      }
      applyTimelineStep();
      return true;
    } catch (err) {
      handleError(
        err,
        app.setEditStatus,
        `Replay failed at step ${state.replayPosition}`,
      );
      stopPlay();
      return false;
    }
  }

  /** The timeline, the selectors and the plots, for the step at the playhead. */
  function applyTimelineStep() {
    updateTimelineUi();
    const step = currentStep(state);
    if (step && step.muIdx >= 0 && step.muIdx < state.distimes.length) {
      showMu(step.muIdx);
    }
    app.renderAll();
  }

  /**
   * Select MU `mu` and its grid in the selectors.
   *
   * @param {number} mu
   */
  function showMu(mu) {
    setCurrentGrid(state, state.muGridIndex[mu] || 0);
    fillGridSelect();
    fillMuSelect(mu);
  }

  /** @param {number} groupIdx */
  async function applyGroupForward(groupIdx) {
    const group = getActiveReplayGroups(state)[groupIdx];
    if (!group) return;
    for (const stepIdx of group.indices) {
      await applyStepForward(stepIdx);
    }
    app.setEditStatus(
      `Applied replay step ${groupIdx + 1}/${getActiveReplayGroups(state).length}: ${group.type}`,
    );
  }

  /** @param {number} groupIdx */
  function undoGroupBackward(groupIdx) {
    const group = getActiveReplayGroups(state)[groupIdx];
    if (!group) return;
    for (let i = group.indices.length - 1; i >= 0; i -= 1) {
      undoStepBackward(group.indices[i]);
    }
    app.setEditStatus(
      `Reverted replay step ${groupIdx + 1}/${getActiveReplayGroups(state).length}: ${group.type}`,
    );
  }

  /** @param {number} stepIdx */
  async function applyStepForward(stepIdx) {
    const step = state.history[stepIdx];
    if (!step) return;
    const mu = resolveStepMuIndex(state, step);
    if (mu < 0 || mu >= state.distimes.length) return;

    pushReplayBackup(state, {
      stepIdx,
      muIdx: mu,
      distimes: [...(state.distimes[mu] || [])],
      pulseTrain: [...(state.pulseTrains[mu] || [])],
      artifactTimes: [...(state.artifactTimes[mu] || [])],
    });

    if (String(step.type || "").toLowerCase() === "update_filter") {
      await refitStep(stepIdx, step, mu);
    } else if (isArtifactStep(step)) {
      setMuRows(state, mu, {
        artifactTimes: applyArtifactDiffForward(state.artifactTimes[mu], step),
      });
    } else {
      setMuRows(state, mu, {
        distimes: applyLoggedDiffForward(state.distimes[mu], step),
      });
    }
    showMu(mu);
  }

  /**
   * Refit MU `mu` as the logged `update_filter` step did; on failure, apply the step's diff.
   *
   * @param {number} stepIdx
   * @param {EditLogEntry} step
   * @param {number} mu
   */
  async function refitStep(stepIdx, step, mu) {
    const pulse = state.pulseTrains[mu] || pulseForCurrentMu(state);
    const grid = state.muGridIndex[mu] || 0;
    try {
      const out = await api.updateFilter({
        mu_index: mu,
        distimes: state.distimes,
        pulse_train: pulse,
        bids_root: getBidsRoot(state),
        entity_label: getEntityLabel(state),
        grid_index: grid,
        grid_name: state.gridNames[grid] || "",
        mu_grid_index: state.muGridIndex,
        inactive_mus: inactiveMusBefore(state.history, stepIdx, state.muUids),
        view_start: step.viewStart ?? 0,
        view_end: step.viewEnd ?? pulse.length,
        nbextchan: DEFAULT_NBEXTCHAN,
        use_peeloff: step.usePeeloff ?? false,
        lock_spikes: step.lockSpikes ?? false,
        artifact_times: state.artifactTimes[mu] || [],
        artifact_regions: state.artifactRegions || [],
      });
      setMuRows(state, mu, {
        distimes: Array.isArray(out.distimes)
          ? out.distimes.map(Number).filter((n) => Number.isFinite(n))
          : undefined,
        pulseTrain: Array.isArray(out.pulse_train)
          ? out.pulse_train.map((n) => Number(n) || 0)
          : undefined,
      });
    } catch (err) {
      app.setEditStatus(`update_filter step fallback (${errorMessage(err)})`);
      setMuRows(state, mu, {
        distimes: applyLoggedDiffForward(state.distimes[mu], step),
      });
    }
  }

  /** @param {number} stepIdx */
  function undoStepBackward(stepIdx) {
    const step = state.history[stepIdx];
    if (!step) return;
    const backup = popReplayBackup(state);
    if (!backup || backup.stepIdx !== stepIdx) {
      // No backup for this step: undo its logged diff instead.
      const mu = resolveStepMuIndex(state, step);
      if (mu < 0 || mu >= state.distimes.length) return;
      if (isArtifactStep(step)) {
        setMuRows(state, mu, {
          artifactTimes: applyArtifactDiffBackward(
            state.artifactTimes[mu],
            step,
          ),
        });
      } else {
        setMuRows(state, mu, {
          distimes: applyLoggedDiffBackward(state.distimes[mu], step),
        });
      }
      return;
    }
    // A session with no artifacts keeps `artifactTimes` empty; restoring an
    // empty row into it would grow one entry per MU an undo passes through.
    const keepArtifacts =
      backup.artifactTimes.length ||
      state.artifactTimes[backup.muIdx] !== undefined;
    setMuRows(state, backup.muIdx, {
      distimes: backup.distimes,
      pulseTrain: backup.pulseTrain,
      artifactTimes: keepArtifacts ? backup.artifactTimes : undefined,
    });
    showMu(backup.muIdx);
  }

  /**
   * One timeline entry standing for a run of steps.
   *
   * @param {EditLogEntry[]} steps
   * @returns {EditLogEntry | null}
   */
  function mergeStepsForDisplay(steps) {
    if (!steps.length) return null;
    if (steps.length === 1) return steps[0];
    const first = steps[0];
    const last = steps[steps.length - 1];
    const muSet = new Set(steps.map((s) => stepMuKey(s)));
    const starts = steps.flatMap((s) =>
      s.viewStart != null ? [s.viewStart] : [],
    );
    const ends = steps.flatMap((s) => (s.viewEnd != null ? [s.viewEnd] : []));
    return {
      ...last,
      type: "spike_edits",
      timestamp: `${first.timestamp} -> ${last.timestamp}`,
      viewStart: starts.length ? Math.min(...starts) : null,
      viewEnd: ends.length ? Math.max(...ends) : null,
      spikesAdded: [...new Set(steps.flatMap((s) => s.spikesAdded || []))],
      spikesRemoved: [...new Set(steps.flatMap((s) => s.spikesRemoved || []))],
      muIdx: muSet.size === 1 ? resolveStepMuIndex(state, first) : -1,
      muUid: muSet.size === 1 ? first.muUid : "",
      groupedCount: steps.length,
    };
  }

  /**
   * The marks the log puts on MUs: flagged, duplicated or removed, by uid.
   *
   * @returns {Record<string, string>}
   */
  function logMarks() {
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
    return marks;
  }

  /** Group the log into timeline steps: a run of spike edits on one MU is one step. */
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
      let j = i + 1;
      while (
        j < state.history.length &&
        isSpikeEditStep(state.history[j]) &&
        stepMuKey(state.history[j]) === key
      ) {
        j += 1;
      }
      const indices = Array.from({ length: j - i }, (_, k) => i + k);
      groups.push({
        indices,
        type: "spike_edits",
        displayStep: mergeStepsForDisplay(indices.map((k) => state.history[k])),
      });
      i = j;
    }
    const marks = logMarks();
    const liveUids = new Set(state.muUids);
    setReplayGroups(
      state,
      groups,
      marks,
      Object.keys(marks).filter((uid) => !liveUids.has(uid)),
    );
    rebuildFilteredReplayGroups();
  }

  /** Keep the groups that touch the current MU, leaving out MUs the file no longer has. */
  function rebuildFilteredReplayGroups() {
    const ghostUids = new Set(state.muGhostUids);
    setFilteredReplayGroups(
      state,
      state.replayGroups.filter((group) => {
        const uid = group.displayStep?.muUid || "";
        if (uid && ghostUids.has(uid)) return false;
        return group.indices.some(
          (idx) =>
            resolveStepMuIndex(state, state.history[idx]) === state.currentMu,
        );
      }),
    );
  }

  /**
   * The rows the replay starts from: the loaded decomposition, or, for a file
   * saved after the edits, the edits undone in reverse.
   *
   * @returns {import("../../state/actions.js").ReplayBase}
   */
  function replayBase() {
    const base = {
      distimes: state.distimes.map((row) => [...row]),
      pulseTrains: state.pulseTrains,
      artifactTimes: state.artifactTimes,
    };
    if (state.loadedFromDecomp) return base;
    base.artifactTimes = state.artifactTimes.map((row) => [...(row || [])]);
    for (let i = state.history.length - 1; i >= 0; i -= 1) {
      const step = state.history[i];
      const mu = resolveStepMuIndex(state, step);
      if (mu < 0 || mu >= base.distimes.length) continue;
      base.distimes[mu] = applyLoggedDiffBackward(base.distimes[mu], step);
      if (isArtifactStep(step) && mu < base.artifactTimes.length) {
        base.artifactTimes[mu] = applyArtifactDiffBackward(
          base.artifactTimes[mu],
          step,
        );
      }
    }
    return base;
  }

  /** @type {ReplayService["startReplay"]} */
  function startReplay() {
    stopPlay();
    rebuildReplayGroups();
    const grid = firstGridWithMu(state);
    setCurrentGrid(state, grid);
    setCurrentMu(state, musForGrid(state, grid)[0] ?? 0);
    fillGridSelect();
    fillMuSelect();
    rebuildFilteredReplayGroups();
    setReplayBase(state, replayBase());
    applyTimelineStep();
  }

  /** Back to step 0 of the current MU's timeline. */
  function resetReplayForCurrentMu() {
    restoreReplayBase(state);
    applyTimelineStep();
  }

  /**
   * Whether MU `mu` can be chosen: unmarked, or only flagged.
   *
   * @param {number} mu
   */
  function isSelectable(mu) {
    const mark = state.muMarks[state.muUids[mu] || ""];
    return !mark || mark === "flagged";
  }

  /** @param {string} value @param {string} text @param {boolean} [disabled] */
  function addOption(value, text, disabled = false) {
    const option = document.createElement("option");
    option.value = value;
    option.textContent = text;
    option.disabled = disabled;
    return option;
  }

  function fillGridSelect() {
    els.editMuGridSelect.innerHTML = "";
    const labels = state.gridNames.length ? state.gridNames : ["Grid 1"];
    labels.forEach((name, idx) => {
      els.editMuGridSelect.appendChild(
        addOption(String(idx), `Grid ${idx + 1}${name ? ` • ${name}` : ""}`),
      );
    });
    els.editMuGridSelect.value = String(state.currentGrid);
  }

  /**
   * List the current grid's MUs, then the ones the log removed; select `forceMu`, or keep a selectable one.
   *
   * @param {number | null} [forceMu]
   */
  function fillMuSelect(forceMu = null) {
    const mus = musForGrid(state, state.currentGrid);
    els.editMuSelect.innerHTML = "";
    if (!mus.length) {
      els.editMuSelect.appendChild(addOption("0", "No MUs"));
      setCurrentMu(state, 0);
      return;
    }
    mus.forEach((mu) => {
      const mark = state.muMarks[state.muUids[mu] || ""];
      const prefix = mark ? `${MARK_PREFIX[mark] || ""} ` : "";
      els.editMuSelect.appendChild(
        addOption(String(mu), `${prefix}MU ${mu + 1}`, !isSelectable(mu)),
      );
    });
    state.muGhostUids
      .filter((uid) => Number(uid.match(/^g(\d+)_/)?.[1]) === state.currentGrid)
      .forEach((uid) => {
        const mark = state.muMarks[uid];
        const prefix = MARK_PREFIX[mark] || "—";
        els.editMuSelect.appendChild(
          addOption("", `${prefix} ${uid} (removed)`, true),
        );
      });
    if (forceMu != null && mus.includes(forceMu)) setCurrentMu(state, forceMu);
    else if (!mus.includes(state.currentMu)) setCurrentMu(state, mus[0]);
    if (!isSelectable(state.currentMu)) {
      const first = mus.find(isSelectable);
      if (first != null) setCurrentMu(state, first);
    }
    els.editMuSelect.value = String(state.currentMu);
  }

  /** @type {ReplayService["updateTimelineUi"]} */
  function updateTimelineUi() {
    const total = getActiveReplayGroups(state).length;
    els.timelineSlider.max = String(total);
    els.timelineSlider.value = String(clamp(state.replayPosition, 0, total));
    els.timelineSlider.disabled = total === 0;
    els.prevStepBtn.disabled = total === 0 || state.replayPosition <= 0;
    els.nextStepBtn.disabled = total === 0 || state.replayPosition >= total;
    els.playPauseBtn.disabled = total === 0;
    if (els.timelineCounter)
      els.timelineCounter.textContent = `Step ${state.replayPosition} / ${total}`;
    updateTimelineTrackColors();
  }

  /** Paint each timeline step in the slider's track by what it did to the current MU. */
  function updateTimelineTrackColors() {
    const groups = getActiveReplayGroups(state);
    if (!groups.length) {
      els.timelineSlider.style.setProperty(
        "--timeline-gradient",
        "var(--border)",
      );
      return;
    }
    const parts = groups.flatMap((group, i) => {
      const start = (i / groups.length) * 100;
      const end = ((i + 1) / groups.length) * 100;
      const kind = groupColorKind(group);
      if (kind === "split_add_remove") {
        const mid = (start + end) / 2;
        return [
          `var(--timeline-added) ${start}%`,
          `var(--timeline-added) ${mid}%`,
          `var(--timeline-removed) ${mid}%`,
          `var(--timeline-removed) ${end}%`,
        ];
      }
      const color = {
        add: "var(--timeline-added)",
        remove: "var(--timeline-removed)",
        update_filter: "var(--accent)",
        artifact: "var(--artifact)",
        neutral: "var(--border)",
      }[kind];
      return [`${color} ${start}%`, `${color} ${end}%`];
    });
    els.timelineSlider.style.setProperty(
      "--timeline-gradient",
      `linear-gradient(to right, ${parts.join(", ")})`,
    );
  }

  /**
   * @param {ReplayGroup} group
   * @returns {"neutral" | "split_add_remove" | "add" | "remove" | "update_filter" | "artifact"}
   */
  function groupColorKind(group) {
    const types = group.indices
      .map((idx) => state.history[idx])
      .filter((step) => resolveStepMuIndex(state, step) === state.currentMu)
      .map((step) => String(step?.type || "").toLowerCase());
    if (types.includes("update_filter")) return "update_filter";
    if (types.some((t) => t === "add_artifact" || t === "delete_artifact"))
      return "artifact";
    const hasAdd = types.includes("add_spikes");
    const hasRemove = types.some(
      (t) =>
        t === "delete_spikes" || t === "delete_dr" || t === "remove_outliers",
    );
    if (hasAdd && hasRemove) return "split_add_remove";
    if (hasAdd) return "add";
    if (hasRemove) return "remove";
    return "neutral";
  }

  return {
    onGridChange,
    onMuChange,
    goToMu,
    adjustReplayView,
    onTimelineChange,
    moveStep,
    togglePlay,
    startReplay,
    updateTimelineUi,
  };
}
