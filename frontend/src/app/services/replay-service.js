/**
 * Replay service: the replay engine.
 *
 * Groups the log into timeline steps, applies and undoes them on the current
 * MU's rows, and asks the backend to refit `update_filter` steps on the BIDS
 * EMG. Every step applied forward pushes a backup, so undoing it restores the
 * rows exactly; a refit that fails falls back to the step's logged diff.
 */
import { normalizeRefitResult } from "../../api/payloads.js";
import {
  applyDiff,
  clamp,
  inactiveMusBefore,
  isArtifactStep,
  isSpikeEditStep,
  shiftViewInside,
} from "../../replay/operations.js";
import {
  popReplayBackup,
  pushReplayBackup,
  restoreReplayBase,
  setCurrentGrid,
  setCurrentMu,
  setMuRows,
  setPlayTimer,
  setReplayBase,
  setReplayGroups,
  setReplayPosition,
  setReplayView,
  setTimelineGroups,
} from "../../state/actions.js";
import {
  currentStep,
  clampedReplayView,
  musForGrid,
  pulseTrainForCurrentMu,
} from "../../state/selectors.js";
import { errorMessage, handleError } from "./error-service.js";

/** @typedef {import("../../state/state.js").EditLogEntry} EditLogEntry */
/** @typedef {import("../../state/state.js").MuMark} MuMark */
/** @typedef {import("../../state/state.js").ReplayGroup} ReplayGroup */
/** @typedef {import("../context.js").ReplayService} ReplayService */

/** Milliseconds between steps while playing. */
const PLAY_INTERVAL_MS = 700;
/**
 * Option prefixes for the marks the log puts on an MU.
 *
 * @type {Record<MuMark, string>}
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
    rebuildTimelineGroups();
    resetReplayForCurrentMu();
  }

  /** @type {ReplayService["onMuChange"]} */
  function onMuChange(event) {
    setCurrentMu(
      state,
      Number(/** @type {HTMLSelectElement} */ (event.target).value) || 0,
    );
    rebuildTimelineGroups();
    resetReplayForCurrentMu();
  }

  /** @type {ReplayService["goToMu"]} */
  function goToMu(direction) {
    const mus = musForGrid(state, state.currentGrid);
    if (!mus.length) return;
    const current = state.currentMu;
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
    rebuildTimelineGroups();
    resetReplayForCurrentMu();
  }

  /** @type {ReplayService["adjustReplayView"]} */
  function adjustReplayView(action) {
    const totalSamples = pulseTrainForCurrentMu(state).length;
    if (!totalSamples) return;
    const view = clampedReplayView(state, totalSamples);
    const span = Math.max(1, view.end - view.start);
    const center = view.start + span / 2;
    let nextStart = view.start;
    let nextEnd = view.end;
    if (action === "zoom_in" || action === "zoom_out") {
      const nextSpan =
        action === "zoom_in"
          ? Math.max(10, Math.round(span * 0.8))
          : Math.min(totalSamples, Math.round(span * 1.5));
      nextStart = Math.round(center - nextSpan / 2);
      nextEnd = Math.round(center + nextSpan / 2);
    } else if (action === "scroll_left" || action === "scroll_right") {
      const step = Math.max(1, Math.round(span * 0.05));
      const shift = action === "scroll_left" ? -step : step;
      nextStart += shift;
      nextEnd += shift;
    }
    setReplayView(state, shiftViewInside(nextStart, nextEnd, totalSamples));
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
    const groups = state.timelineGroups;
    if (!groups.length) return;
    void seekReplayPosition(
      clamp(state.replayPosition + delta, 0, groups.length),
    );
  }

  /** @type {ReplayService["togglePlay"]} */
  function togglePlay() {
    if (!state.timelineGroups.length) return;
    if (state.playTimer !== null) {
      stopPlay();
      return;
    }
    els.playPauseBtn.textContent = "⏸";
    const timer = window.setInterval(() => {
      // A step that replays update_filter takes longer than this interval, so
      // skip the tick rather than stacking a second seek on top of it.
      if (seeking) return;
      if (state.replayPosition >= state.timelineGroups.length) {
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
    if (state.playTimer !== null) window.clearInterval(state.playTimer);
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
    const target = clamp(targetPos, 0, state.timelineGroups.length);
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
        app.setReplayStatus,
        `Could not replay step ${state.replayPosition + 1}`,
      );
      stopPlay();
      return false;
    }
  }

  /** The timeline, the selectors and the plots, for the step at the playhead. */
  function applyTimelineStep() {
    updateTimelineUi();
    const step = currentStep(state);
    if (step) showMu(step.mu);
    app.renderAll();
  }

  /**
   * Select MU `mu` and its grid in the selectors.
   *
   * @param {number} mu
   */
  function showMu(mu) {
    setCurrentGrid(state, state.muGridIndex[mu]);
    fillGridSelect();
    fillMuSelect(mu);
  }

  // A timeline group's steps are all on the current MU, so every step applied
  // forward pushes a backup and every step undone pops its own.

  /** @param {number} groupIdx */
  async function applyGroupForward(groupIdx) {
    const group = state.timelineGroups[groupIdx];
    let refitError = "";
    for (const stepIdx of group.indices) {
      refitError = (await applyStepForward(stepIdx)) || refitError;
    }
    const where = `step ${groupIdx + 1} of ${state.timelineGroups.length}`;
    if (refitError) {
      app.setReplayStatus(
        `Replayed ${where} from the edit log: could not recompute the filter. ${refitError}`,
        "error",
      );
    } else {
      app.setReplayStatus(`Applied ${where}: ${group.type}.`);
    }
  }

  /** @param {number} groupIdx */
  function undoGroupBackward(groupIdx) {
    const group = state.timelineGroups[groupIdx];
    for (let i = group.indices.length - 1; i >= 0; i -= 1) {
      undoStepBackward();
    }
    app.setReplayStatus(
      `Undid step ${groupIdx + 1} of ${state.timelineGroups.length}: ${group.type}.`,
    );
  }

  /**
   * @param {number} stepIdx
   * @returns {Promise<string>} Why a refit fell back to the logged diff; empty when none did.
   */
  async function applyStepForward(stepIdx) {
    const step = state.editHistory[stepIdx];
    const { mu } = step;
    let refitError = "";
    pushReplayBackup(state, {
      mu,
      spikes: [...state.spikeTimes[mu]],
      pulseTrain: [...state.pulseTrains[mu]],
      artifacts: [...state.artifactTimes[mu]],
    });
    if (step.type === "update_filter") {
      refitError = await refitStep(stepIdx, step);
    } else {
      applyLoggedDiff(step);
    }
    showMu(mu);
    return refitError;
  }

  /**
   * Apply `step`'s logged diff to its MU's artifact markers or discharges.
   *
   * @param {EditLogEntry} step
   */
  function applyLoggedDiff(step) {
    const { mu } = step;
    if (isArtifactStep(step)) {
      setMuRows(state, mu, {
        artifacts: applyDiff(
          state.artifactTimes[mu],
          step.artifactsAdded,
          step.artifactsRemoved,
        ),
      });
    } else {
      setMuRows(state, mu, {
        spikes: applyDiff(
          state.spikeTimes[mu],
          step.spikesAdded,
          step.spikesRemoved,
        ),
      });
    }
  }

  /**
   * Refit the step's MU as the logged `update_filter` step did; on failure, apply the step's diff.
   *
   * @param {number} stepIdx
   * @param {EditLogEntry} step
   * @returns {Promise<string>} Why the refit failed; empty when it succeeded.
   */
  async function refitStep(stepIdx, step) {
    const { mu } = step;
    const pulseTrain = state.pulseTrains[mu];
    const grid = state.muGridIndex[mu];
    try {
      const refit = normalizeRefitResult(
        await api.updateFilter({
          mu,
          spike_times: state.spikeTimes,
          pulse_train: pulseTrain,
          bids_root: state.bidsRoot,
          entity_label: state.entityLabel,
          grid_name: state.gridNames[grid] || "",
          mu_grid_index: state.muGridIndex,
          inactive_mus: inactiveMusBefore(
            state.editHistory,
            stepIdx,
            state.muUids,
          ),
          view_start: step.viewStart ?? 0,
          view_end: step.viewEnd ?? pulseTrain.length,
          nbextchan: state.refitSettings.nbextchan,
          peel_off_win: state.refitSettings.peelOffWin,
          compute_dtype: state.refitSettings.computeDtype,
          use_peeloff: step.usePeeloff,
          lock_spikes: step.lockSpikes,
          artifact_times: state.artifactTimes[mu],
          artifact_regions: state.artifactRegions,
        }),
      );
      setMuRows(state, mu, refit);
      return "";
    } catch (err) {
      applyLoggedDiff(step);
      return errorMessage(err);
    }
  }

  /** Restore the rows the newest backup holds. */
  function undoStepBackward() {
    const backup = /** @type {import("../../state/state.js").ReplayBackup} */ (
      popReplayBackup(state)
    );
    setMuRows(state, backup.mu, {
      spikes: backup.spikes,
      pulseTrain: backup.pulseTrain,
      artifacts: backup.artifacts,
    });
    showMu(backup.mu);
  }

  /**
   * One timeline entry standing for a run of steps.
   *
   * @param {EditLogEntry[]} steps Spike edits on one MU.
   * @returns {EditLogEntry}
   */
  function mergeStepsForDisplay(steps) {
    if (steps.length === 1) return steps[0];
    const last = steps[steps.length - 1];
    const starts = steps.flatMap((s) =>
      s.viewStart != null ? [s.viewStart] : [],
    );
    const ends = steps.flatMap((s) => (s.viewEnd != null ? [s.viewEnd] : []));
    return {
      ...last,
      type: "spike_edits",
      viewStart: starts.length ? Math.min(...starts) : null,
      viewEnd: ends.length ? Math.max(...ends) : null,
      spikesAdded: [...new Set(steps.flatMap((s) => s.spikesAdded))],
      spikesRemoved: [...new Set(steps.flatMap((s) => s.spikesRemoved))],
    };
  }

  /**
   * The marks the log puts on MUs: flagged, duplicated or removed, by uid.
   *
   * @returns {Record<string, MuMark>}
   */
  function logMarks() {
    /** @type {Record<string, MuMark>} */
    const marks = {};
    for (const step of state.editHistory) {
      const { type } = step;
      if (type === "flag_mu" && step.muUid) {
        marks[step.muUid] = "flagged";
      } else if (type === "duplicate_mu") {
        if (step.muUid) marks[step.muUid] = marks[step.muUid] || "duplicate";
        const sourceUid = step.sourceMuUid;
        if (sourceUid) marks[sourceUid] = marks[sourceUid] || "duplicate";
      } else if (type === "remove_duplicates" || type === "remove_flagged") {
        step.removedMuUids.forEach((uid) => {
          marks[uid] = "removed";
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
    while (i < state.editHistory.length) {
      const step = state.editHistory[i];
      if (!isSpikeEditStep(step)) {
        groups.push({
          indices: [i],
          type: step.type,
          displayStep: step,
        });
        i += 1;
        continue;
      }
      let j = i + 1;
      while (
        j < state.editHistory.length &&
        isSpikeEditStep(state.editHistory[j]) &&
        state.editHistory[j].muUid === step.muUid
      ) {
        j += 1;
      }
      const indices = Array.from({ length: j - i }, (_, k) => i + k);
      groups.push({
        indices,
        type: "spike_edits",
        displayStep: mergeStepsForDisplay(
          indices.map((k) => state.editHistory[k]),
        ),
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
    rebuildTimelineGroups();
  }

  /** Keep the groups that touch the current MU, leaving out MUs the file no longer has. */
  function rebuildTimelineGroups() {
    const ghostUids = new Set(state.muGhostUids);
    setTimelineGroups(
      state,
      state.replayGroups.filter((group) => {
        const uid = group.displayStep.muUid;
        if (uid && ghostUids.has(uid)) return false;
        return group.indices.some(
          (idx) => state.editHistory[idx].mu === state.currentMu,
        );
      }),
    );
  }

  /**
   * The rows the replay starts from: the loaded decomposition, or, for a file
   * saved after the edits, the edits undone in reverse.
   *
   * @returns {import("../../state/state.js").ReplayBase}
   */
  function replayBase() {
    const base = {
      spikeTimes: state.spikeTimes,
      pulseTrains: state.pulseTrains,
      artifactTimes: state.artifactTimes,
    };
    if (state.loadedFromDecomp) return base;
    // `setReplayBase` copies the rows and the rewind only replaces them, so
    // copying the outer arrays is enough to leave the state's untouched.
    base.spikeTimes = [...state.spikeTimes];
    base.artifactTimes = [...state.artifactTimes];
    for (let i = state.editHistory.length - 1; i >= 0; i -= 1) {
      const step = state.editHistory[i];
      const { mu } = step;
      if (mu < 0) continue;
      if (!isArtifactStep(step)) {
        base.spikeTimes[mu] = applyDiff(
          base.spikeTimes[mu],
          step.spikesRemoved,
          step.spikesAdded,
        );
      } else {
        base.artifactTimes[mu] = applyDiff(
          base.artifactTimes[mu],
          step.artifactsRemoved,
          step.artifactsAdded,
        );
      }
    }
    return base;
  }

  /** @type {ReplayService["startReplay"]} */
  function startReplay() {
    stopPlay();
    rebuildReplayGroups();
    // The grid of the first MU, not the lowest grid number.
    const grid = state.muGridIndex[0] ?? 0;
    setCurrentGrid(state, grid);
    setCurrentMu(state, musForGrid(state, grid)[0] ?? 0);
    fillGridSelect();
    fillMuSelect();
    rebuildTimelineGroups();
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
  function createOption(value, text, disabled = false) {
    const option = document.createElement("option");
    option.value = value;
    option.textContent = text;
    option.disabled = disabled;
    return option;
  }

  function fillGridSelect() {
    els.gridSelect.innerHTML = "";
    state.gridNames.forEach((name, idx) => {
      els.gridSelect.appendChild(
        createOption(String(idx), `Grid ${idx + 1}${name ? ` • ${name}` : ""}`),
      );
    });
    els.gridSelect.value = String(state.currentGrid);
  }

  /**
   * List the current grid's MUs, then the ones the log removed; select `forceMu`, or keep a selectable one.
   *
   * @param {number | null} [forceMu]
   */
  function fillMuSelect(forceMu = null) {
    const mus = musForGrid(state, state.currentGrid);
    els.muSelect.innerHTML = "";
    if (!mus.length) {
      els.muSelect.appendChild(createOption("0", "No MUs"));
      setCurrentMu(state, 0);
      return;
    }
    mus.forEach((mu) => {
      const mark = state.muMarks[state.muUids[mu] || ""];
      const prefix = mark ? `${MARK_PREFIX[mark]} ` : "";
      els.muSelect.appendChild(
        createOption(String(mu), `${prefix}MU ${mu + 1}`, !isSelectable(mu)),
      );
    });
    // A ghost uid is a key of `muMarks`, so it always has a mark.
    state.muGhostUids
      .filter((uid) => Number(uid.match(/^g(\d+)_/)?.[1]) === state.currentGrid)
      .forEach((uid) => {
        els.muSelect.appendChild(
          createOption(
            "",
            `${MARK_PREFIX[state.muMarks[uid]]} ${uid} (removed)`,
            true,
          ),
        );
      });
    if (forceMu != null && mus.includes(forceMu)) setCurrentMu(state, forceMu);
    else if (!mus.includes(state.currentMu)) setCurrentMu(state, mus[0]);
    if (!isSelectable(state.currentMu)) {
      const first = mus.find(isSelectable);
      if (first != null) setCurrentMu(state, first);
    }
    els.muSelect.value = String(state.currentMu);
  }

  /** @type {ReplayService["updateTimelineUi"]} */
  function updateTimelineUi() {
    const total = state.timelineGroups.length;
    els.timelineSlider.max = String(total);
    els.timelineSlider.value = String(clamp(state.replayPosition, 0, total));
    els.timelineSlider.disabled = total === 0;
    els.prevStepBtn.disabled = total === 0 || state.replayPosition <= 0;
    els.nextStepBtn.disabled = total === 0 || state.replayPosition >= total;
    els.playPauseBtn.disabled = total === 0;
    els.timelineCounter.textContent = `Step ${state.replayPosition} / ${total}`;
    updateTimelineTrackColors();
  }

  /** Paint each timeline step in the slider's track by what it did to the current MU. */
  function updateTimelineTrackColors() {
    const groups = state.timelineGroups;
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
          `var(--plot-timeline-added) ${start}%`,
          `var(--plot-timeline-added) ${mid}%`,
          `var(--plot-timeline-removed) ${mid}%`,
          `var(--plot-timeline-removed) ${end}%`,
        ];
      }
      const color = {
        add: "var(--plot-timeline-added)",
        remove: "var(--plot-timeline-removed)",
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
    const steps = group.indices
      .map((idx) => state.editHistory[idx])
      .filter((step) => step.mu === state.currentMu);
    const types = steps.map((step) => step.type);
    if (types.includes("update_filter")) return "update_filter";
    if (steps.some(isArtifactStep)) return "artifact";
    const hasAdd = types.includes("add_spikes");
    const hasRemove = steps.some(
      (step) => isSpikeEditStep(step) && step.type !== "add_spikes",
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
