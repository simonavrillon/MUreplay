/**
 * Replay service: the timeline over the server's replay.
 *
 * Groups the log into timeline steps and asks the server to move its replay
 * session to the current MU's steps up to the playhead; the server applies
 * and undoes them (and refits `update_filter` steps on the BIDS EMG), and
 * answers with what changed. The pulse train on screen is a window the
 * server sends, fetched again whenever the view or the MU's version moves.
 */
import { normalizeReplayChange } from "../../api/payloads.js";
import {
  clamp,
  diffSquares,
  dischargeDiff,
  isArtifactStep,
  isSpikeEditStep,
  shiftViewInside,
} from "../../replay/operations.js";
import {
  applyReplayChange,
  resetReplayPosition,
  setCurrentGrid,
  setCurrentMu,
  setPlayTimer,
  setPulseView,
  setReplayGroups,
  setReplayPosition,
  setReplayView,
  setTimelineGroups,
} from "../../state/actions.js";
import {
  currentStep,
  clampedReplayView,
  musForGrid,
} from "../../state/selectors.js";
import { getCanvasPlotMetrics } from "../../view/plots.js";
import { handleError } from "./error-service.js";
import { createViewFetcher } from "./view-fetcher.js";

/** @typedef {import("../../state/state.js").EditLogEntry} EditLogEntry */
/** @typedef {import("../../state/state.js").MuMark} MuMark */
/** @typedef {import("../../state/state.js").ReplayChange} ReplayChange */
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
    resetReplayForCurrentMu();
  }

  /** @type {ReplayService["onMuChange"]} */
  function onMuChange(event) {
    setCurrentMu(
      state,
      Number(/** @type {HTMLSelectElement} */ (event.target).value) || 0,
    );
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
    resetReplayForCurrentMu();
  }

  /** @type {ReplayService["adjustReplayView"]} */
  function adjustReplayView(action) {
    const totalSamples = state.totalSamples;
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
    els.playPauseBtn.classList.add("is-running");
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
    els.playPauseBtn.classList.remove("is-running");
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
   * while the play timer and a slider drag fire faster than that. A request
   * that arrives mid-seek parks its target here and the run in flight picks
   * up the newest one when it finishes, so the server sees one seek at a
   * time. Parking only the newest keeps a drag cheap: the steps scrubbed
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
   * Ask the server to hold the current MU's steps up to `targetPos`, and show what changed.
   *
   * @param {number} targetPos
   * @returns {Promise<boolean>} `false` when the seek failed, so the caller stops
   *   instead of running whatever was queued behind it.
   */
  async function runSeek(targetPos) {
    const { token } = state;
    const groups = state.timelineGroups;
    const target = clamp(targetPos, 0, groups.length);
    const steps = groups.slice(0, target).flatMap((group) => group.indices);
    try {
      const change = normalizeReplayChange(
        await api.replaySeek({ token, steps }),
      );
      // Another trial was opened meanwhile: this answer is not about it.
      if (state.token !== token) return true;
      applyReplayChange(state, change);
      // Another MU was picked meanwhile: the server moved as asked, but the
      // playhead belongs to the new timeline and the seek parked behind this one.
      if (state.timelineGroups !== groups) return true;
      const from = state.replayPosition;
      setReplayPosition(state, target);
      reportSeek(groups, from, target, change);
      applyTimelineStep();
      return true;
    } catch (err) {
      handleError(err, app.setReplayStatus, `Could not replay step ${target}`);
      stopPlay();
      return false;
    }
  }

  /**
   * Say what a seek from `from` to `target` did: the step it applied or
   * undid, or the refit it replayed from the log instead, and why.
   *
   * @param {ReplayGroup[]} groups The timeline the seek moved along.
   * @param {number} from
   * @param {number} target
   * @param {ReplayChange} change
   */
  function reportSeek(groups, from, target, change) {
    const failed = change.refitErrors[change.refitErrors.length - 1];
    if (failed) {
      const idx = groups.findIndex((g) => g.indices.includes(failed.step));
      app.setReplayStatus(
        `Replayed step ${idx + 1} of ${groups.length} from the edit log: could not recompute the filter. ${failed.message}`,
        "error",
      );
    } else if (target > from) {
      app.setReplayStatus(
        `Applied step ${target} of ${groups.length}: ${groups[target - 1].type}.`,
      );
    } else if (target < from) {
      app.setReplayStatus(
        `Undid step ${target + 1} of ${groups.length}: ${groups[target].type}.`,
      );
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
    // A session opens at step 0 on the server too.
    resetReplayPosition(state);
    prepareGridForCurrentMu();
    applyTimelineStep();
  }

  /** The current MU's timeline at step 0, here and on the server. */
  function resetReplayForCurrentMu() {
    rebuildTimelineGroups();
    resetReplayPosition(state);
    prepareGridForCurrentMu();
    applyTimelineStep();
    void seekReplayPosition(0);
  }

  /**
   * Grids the server was asked to filter, as `token:grid`.
   * @type {Set<string>}
   */
  const preparedGrids = new Set();

  /**
   * Ask the server to filter the current MU's grid while the user looks, when
   * its timeline has a refit: the first `update_filter` step then needn't wait.
   */
  function prepareGridForCurrentMu() {
    const grid = state.muGridIndex[state.currentMu];
    const key = `${state.token}:${grid}`;
    if (!state.token || grid == null || preparedGrids.has(key)) return;
    if (!state.timelineGroups.some((g) => g.type === "update_filter")) return;
    preparedGrids.add(key);
    // A grid that cannot be filtered is reported by the refit that needs it.
    api.replayPrepareGrid({ token: state.token, grid }).catch(() => {
      preparedGrids.delete(key);
    });
  }

  const pulseFetcher = createViewFetcher(
    async (
      /** @type {{ token: string, mu: number, start: number, end: number, bins: number }} */ params,
    ) => ({ token: params.token, view: await api.fetchPulse(params) }),
    ({ token, view }) => {
      // A window of a session since replaced is dropped.
      if (token !== state.token) return;
      setPulseView(state, view);
      app.renderAll();
    },
    (err) =>
      handleError(err, app.setReplayStatus, "Could not draw the pulse train"),
  );

  /** @type {ReplayService["ensurePulseView"]} */
  function ensurePulseView() {
    const canvas = els.editPulseCanvas;
    const total = state.totalSamples;
    const mu = state.currentMu;
    if (!state.token || !canvas || !total || state.spikeTimes[mu] === undefined)
      return;
    const { start, end } = clampedReplayView(state, total);
    const bins = Math.max(
      1,
      Math.round(getCanvasPlotMetrics(canvas).plotWidth),
    );
    const version = state.versions[mu] ?? 0;
    const shown = state.pulseView;
    if (
      shown &&
      shown.mu === mu &&
      shown.version === version &&
      shown.start === start &&
      shown.end === end &&
      shown.bins === bins
    ) {
      return;
    }
    pulseFetcher.want(
      `${state.token}:${mu}:${version}:${start}:${end}:${bins}`,
      {
        token: state.token,
        mu,
        start,
        end,
        bins,
      },
    );
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
    renderTimelineSteps();
    renderDiffSummary();
  }

  /**
   * The step line: a dot for the decomposition as loaded, then one per
   * timeline step, coloured by what it did to the current MU. Dots up to the
   * playhead are filled, the one at it ringed, the rest hollow.
   */
  function renderTimelineSteps() {
    const groups = state.timelineGroups;
    const pos = state.replayPosition;
    const kinds = ["start", ...groups.map(groupColorKind)];
    els.timelineSteps.replaceChildren(
      ...kinds.map((kind, i) => {
        const dot = document.createElement("i");
        dot.className = "timeline-dot";
        dot.dataset.kind = kind;
        if (i <= pos) dot.classList.add("is-done");
        if (i === pos) dot.classList.add("is-current");
        return dot;
      }),
    );
    els.timelineSteps.style.setProperty("--steps", String(kinds.length));
    els.timelineSteps.style.setProperty(
      "--progress",
      String(groups.length ? pos / groups.length : 0),
    );
    els.timelineSlider.title = pos
      ? `Step ${pos} of ${groups.length}: ${groups[pos - 1].type}`
      : "Step 0: the decomposition as loaded";
  }

  /** The discharges the replayed steps added and removed on the current MU, as GitHub counts a commit's lines. */
  function renderDiffSummary() {
    const replayed = state.timelineGroups
      .slice(0, state.replayPosition)
      .flatMap((group) => group.indices.map((idx) => state.editHistory[idx]));
    const { added, removed } = dischargeDiff(replayed, state.currentMu);
    els.diffAdded.textContent = `+${added}`;
    els.diffRemoved.textContent = `−${removed}`;
    els.diffSquares.replaceChildren(
      ...diffSquares(added, removed).map((kind) => {
        const square = document.createElement("span");
        square.className = "diff-square";
        square.dataset.kind = kind;
        return square;
      }),
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
    ensurePulseView,
  };
}
