// The replay engine: step grouping, seeking, update_filter calls and the timeline controls.
import { test, after, describe } from "node:test";
import assert from "node:assert/strict";
import { createReplayService } from "../src/app/services/replay-service.js";
import { normalizeLogEntry } from "../src/api/payloads.js";
import { fakeElement, fakeSelect, installDom } from "./_dom.js";

// What matters most: a step applied forward and then undone leaves the arrays exactly as
// they were, and each step lands on the MU its log entry names.

function fakeEls() {
  return {
    gridSelect: fakeSelect(),
    muSelect: fakeSelect(),
    prevStepBtn: fakeElement(),
    playPauseBtn: fakeElement(),
    nextStepBtn: fakeElement(),
    timelineCounter: fakeElement(),
    timelineSlider: { ...fakeElement(), max: "0", value: "0" },
    timelineSteps: fakeElement(),
    diffAdded: fakeElement(),
    diffRemoved: fakeElement(),
    diffSquares: fakeElement(),
  };
}

const saved = { window: globalThis.window, document: globalThis.document };
installDom();
after(() => Object.assign(globalThis, saved));

/**
 * @param {Partial<import("../src/state/state.js").State>} [overrides]
 */
function makeState(overrides = {}) {
  const nMu = overrides.spikeTimes?.length ?? 0;
  return {
    fsamp: 2048,
    pulseTrains: [],
    spikeTimes: [],
    gridNames: ["Grid 1"],
    muGridIndex: [],
    muUids: [],
    currentGrid: 0,
    currentMu: 0,
    editHistory: [],
    replayGroups: [],
    timelineGroups: [],
    playTimer: null,
    replayBaseSpikeTimes: [],
    replayBasePulseTrains: [],
    replayPosition: 0,
    replayBackups: [],
    replayView: null,
    loadedFromDecomp: true,
    refitSettings: {
      nbextchan: 1000,
      peelOffWin: 0.025,
      computeDtype: "float32",
    },
    muMarks: {},
    muGhostUids: [],
    bidsRoot: "/data",
    entityLabel: "sub-01",
    // One row per MU, as the loader produces.
    artifactTimes: Array.from({ length: nMu }, () => []),
    replayBaseArtifactTimes: [],
    artifactRegions: [],
    ...overrides,
  };
}

/**
 * MUs `g0_mu<n>` on one grid, with the given discharges and a two-sample pulse train each.
 *
 * @param {number[][]} spikeTimes
 * @param {Partial<import("../src/state/state.js").State>} [fields]
 */
function oneGrid(spikeTimes, fields = {}) {
  return {
    spikeTimes,
    pulseTrains: spikeTimes.map(() => [0, 1]),
    muGridIndex: spikeTimes.map(() => 0),
    muUids: spikeTimes.map((_, i) => `g0_mu${i}`),
    ...fields,
  };
}

/**
 * A log entry with every field the service reads, as `normalizeLogEntry` fills them.
 *
 * @param {Partial<import("../src/state/state.js").EditLogEntry>} fields
 */
function step(fields) {
  const mu = fields.mu ?? -1;
  return {
    type: "add_spikes",
    muUid: mu >= 0 ? `g0_mu${mu}` : "",
    mu,
    viewStart: null,
    viewEnd: null,
    spikesAdded: [],
    spikesRemoved: [],
    artifactsAdded: [],
    artifactsRemoved: [],
    usePeeloff: false,
    lockSpikes: false,
    flagged: true,
    sourceMuUid: "",
    removedMuUids: [],
    ...fields,
  };
}

/**
 * The service over a fake context, with the replay started as `file-session.js` does.
 *
 * @param {{
 *   state?: Partial<import("../src/state/state.js").State>,
 *   updateFilter?: (payload: any) => Promise<any>,
 * }} [opts]
 */
function createHarness(opts = {}) {
  const state = makeState(opts.state);
  /** @type {any[]} */
  const filterCalls = [];
  const app = /** @type {any} */ ({
    state,
    els: fakeEls(),
    api: {
      /** @param {any} payload */
      updateFilter: async (payload) => {
        filterCalls.push(payload);
        if (opts.updateFilter) return opts.updateFilter(payload);
        // By default the refit changes nothing.
        return {
          spikes: payload.spike_times[payload.mu],
          pulse_train: payload.pulse_train,
        };
      },
    },
    /** @type {string[]} */
    statuses: [],
    /** @param {string} text */
    setReplayStatus(text) {
      app.statuses.push(text);
    },
    renderAll() {},
    filterCalls,
  });
  Object.assign(app, createReplayService(app));
  app.startReplay();
  return app;
}

/** Everything a replay step is allowed to touch. */
function snapshot(state) {
  return JSON.stringify({
    spikeTimes: state.spikeTimes,
    pulseTrains: state.pulseTrains,
    artifactTimes: state.artifactTimes,
  });
}

/** Settle every promise chain that resolves on its own; one awaiting a stubbed API call stays pending. */
function flush() {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

/** Move the timeline to `pos`; the handler returns before the seek ends, so drain. */
async function seekTo(app, pos) {
  app.onTimelineChange({ target: { value: String(pos) } });
  await flush();
}

describe("rebuildReplayGroups", () => {
  test("collapses a run of spike edits on one MU", () => {
    const app = createHarness({
      state: oneGrid([[10], [10]], {
        editHistory: [
          step({ type: "add_spikes", mu: 0, spikesAdded: [20] }),
          step({ type: "delete_spikes", mu: 0, spikesRemoved: [10] }),
          // A different MU breaks the run.
          step({ type: "add_spikes", mu: 1, spikesAdded: [30] }),
          // So does a step that is not a spike edit.
          step({ type: "update_filter", mu: 1 }),
          step({ type: "remove_outliers", mu: 1, spikesRemoved: [30] }),
        ],
      }),
    });

    assert.deepEqual(
      app.state.replayGroups.map((g) => [g.type, g.indices]),
      [
        ["spike_edits", [0, 1]],
        ["spike_edits", [2]],
        ["update_filter", [3]],
        ["spike_edits", [4]],
      ],
    );
  });

  test("a merged group reports the union of its steps", () => {
    const app = createHarness({
      state: oneGrid([[10]], {
        editHistory: [
          step({ mu: 0, spikesAdded: [20], viewStart: 100, viewEnd: 400 }),
          step({
            type: "delete_spikes",
            mu: 0,
            spikesRemoved: [10],
            viewStart: 50,
            viewEnd: 200,
          }),
        ],
      }),
    });

    const display = app.state.replayGroups[0].displayStep;
    assert.equal(display.type, "spike_edits");
    assert.deepEqual(display.spikesAdded, [20]);
    assert.deepEqual(display.spikesRemoved, [10]);
    assert.equal(display.viewStart, 50);
    assert.equal(display.viewEnd, 400);
    assert.equal(display.mu, 0);
  });
});

describe("the timeline groups", () => {
  test("keeps only the current MU's groups", () => {
    const app = createHarness({
      state: oneGrid([[10], [10]], {
        editHistory: [
          step({ mu: 0, spikesAdded: [20] }),
          step({ mu: 1, spikesAdded: [30] }),
        ],
      }),
    });

    assert.equal(app.state.replayGroups.length, 2);
    assert.equal(app.state.timelineGroups.length, 1);
    assert.deepEqual(app.state.timelineGroups[0].indices, [0]);

    app.onMuChange({ target: { value: "1" } });
    assert.deepEqual(app.state.timelineGroups[0].indices, [1]);
  });
});

describe("seeking the timeline", () => {
  test("a step applied then undone restores the arrays exactly", async () => {
    const app = createHarness({
      state: oneGrid([[10, 30, 50]], {
        pulseTrains: [[0.5, 0.25, 0.75]],
        artifactTimes: [[7]],
        editHistory: [
          step({ mu: 0, spikesAdded: [20], spikesRemoved: [30] }),
          step({ type: "add_artifact", mu: 0, artifactsAdded: [99] }),
          step({ type: "delete_spikes", mu: 0, spikesRemoved: [50] }),
        ],
      }),
    });

    const before = snapshot(app.state);
    const total = app.state.timelineGroups.length;
    assert.equal(total, 3);

    await seekTo(app, total);
    assert.deepEqual(app.state.spikeTimes[0], [10, 20]);
    assert.deepEqual(app.state.artifactTimes[0], [7, 99]);

    await seekTo(app, 0);
    assert.equal(snapshot(app.state), before);
    assert.equal(app.state.replayPosition, 0);
    assert.deepEqual(app.state.replayBackups, []);
  });

  test("stepping forward and back one group at a time round-trips", async () => {
    const app = createHarness({
      state: oneGrid([[10, 30, 50]], {
        pulseTrains: [[0.5, 0.25]],
        artifactTimes: [[7, 42]],
        editHistory: [
          step({ mu: 0, spikesAdded: [20, 40] }),
          step({ type: "delete_artifact", mu: 0, artifactsRemoved: [7] }),
          step({ type: "remove_outliers", mu: 0, spikesRemoved: [50] }),
          step({ type: "add_artifact", mu: 0, artifactsAdded: [77] }),
        ],
      }),
    });

    const before = snapshot(app.state);
    const total = app.state.timelineGroups.length;
    for (let pos = 1; pos <= total; pos += 1) await seekTo(app, pos);
    for (let pos = total - 1; pos >= 0; pos -= 1) await seekTo(app, pos);
    assert.equal(snapshot(app.state), before);
  });

  test("artifact steps apply and undo on their own MU's list", async () => {
    const app = createHarness({
      state: oneGrid([[10], [10]], {
        artifactTimes: [[100], [200]],
        currentMu: 1,
        editHistory: [
          step({ type: "add_artifact", mu: 1, artifactsAdded: [50, 300] }),
        ],
      }),
    });
    app.onMuChange({ target: { value: "1" } });

    await seekTo(app, 1);
    assert.deepEqual(app.state.artifactTimes[1], [50, 200, 300]);
    assert.deepEqual(app.state.artifactTimes[0], [100]);

    await seekTo(app, 0);
    assert.deepEqual(app.state.artifactTimes[1], [200]);
  });

  test("a step naming no MU at all is skipped, not applied to MU 0", () => {
    const app = createHarness({
      state: oneGrid([[10]], { editHistory: [step({ spikesAdded: [20] })] }),
    });

    assert.equal(app.state.timelineGroups.length, 0);
    assert.deepEqual(app.state.spikeTimes[0], [10]);
  });

  test("a seek requested mid-flight runs once the first one finishes", async () => {
    /** @type {(() => void)[]} */
    const gates = [];
    const app = createHarness({
      updateFilter: () =>
        new Promise((resolve) => {
          gates.push(() => resolve({ spikes: [1], pulse_train: [1] }));
        }),
      state: oneGrid([[10], [10], [10]], {
        editHistory: [
          step({ type: "update_filter", mu: 0 }),
          step({ type: "add_spikes", mu: 0, spikesAdded: [20] }),
        ],
      }),
    });

    await seekTo(app, 1);
    assert.equal(app.filterCalls.length, 1);
    assert.equal(app.state.replayPosition, 0, "still waiting on the backend");

    // Two runs would both read replayPosition 0, apply the same group twice and push two
    // backups for it.
    await seekTo(app, 2);
    assert.equal(app.state.replayPosition, 0);
    assert.equal(
      app.filterCalls.length,
      1,
      "the step must not be applied twice",
    );

    gates.forEach((release) => release());
    await flush();
    assert.equal(app.state.replayPosition, 2);
    assert.deepEqual(app.state.spikeTimes[0], [1, 20]);
    assert.equal(app.filterCalls.length, 1);
    assert.equal(app.state.replayBackups.length, 2, "one backup per step");
  });

  test("a session without the decomposition rewinds the edit log for its base", () => {
    // The arrays of an edited file are the end of the session.
    const app = createHarness({
      state: oneGrid([[10, 20]], {
        loadedFromDecomp: false,
        artifactTimes: [[50]],
        editHistory: [
          step({ mu: 0, spikesAdded: [20] }),
          step({ type: "add_artifact", mu: 0, artifactsAdded: [50] }),
        ],
      }),
    });

    assert.deepEqual(app.state.replayBaseSpikeTimes[0], [10]);
    assert.deepEqual(app.state.replayBaseArtifactTimes[0], []);
    assert.deepEqual(app.state.spikeTimes[0], [10]);
    assert.deepEqual(app.state.artifactTimes[0], []);
  });

  test("a uid-keyed log replays onto the MUs it names", async () => {
    // MUedit2's entries name their MU by `mu_uid` alone.
    const muUids = ["g0_mu0", "g0_mu1", "g0_mu2"];
    const editHistory = [
      { type: "add_spikes", mu_uid: "g0_mu2", spikes_added: [20] },
      { type: "delete_spikes", mu_uid: "g0_mu2", spikes_removed: [10] },
    ]
      .map((entry) => normalizeLogEntry(entry, muUids))
      .filter((entry) => entry !== null);

    const app = createHarness({
      state: oneGrid([[10], [10], [10]], { editHistory }),
    });
    app.onMuChange({ target: { value: "2" } });

    const before = snapshot(app.state);
    assert.equal(app.state.timelineGroups.length, 1);

    await seekTo(app, 1);
    assert.deepEqual(app.state.spikeTimes[2], [20]);
    assert.deepEqual(app.state.spikeTimes[0], [10], "MU 0 must not be touched");
    assert.deepEqual(app.state.spikeTimes[1], [10]);

    await seekTo(app, 0);
    assert.equal(snapshot(app.state), before);
  });
});

describe("update_filter", () => {
  test("sends the logged window and stores the recomputed arrays", async () => {
    const app = createHarness({
      updateFilter: async () => ({
        spikes: [10, 25],
        pulse_train: [0.1, 0.9],
      }),
      state: oneGrid([[10, 30]], {
        pulseTrains: [[0, 1, 0, 1]],
        artifactTimes: [[5]],
        artifactRegions: [[1, 2]],
        entityLabel: "sub-01_task-rest",
        refitSettings: {
          nbextchan: 500,
          peelOffWin: 0.03,
          computeDtype: "float64",
        },
        editHistory: [
          step({
            type: "update_filter",
            mu: 0,
            viewStart: 100,
            viewEnd: 400,
            usePeeloff: true,
            lockSpikes: true,
          }),
        ],
      }),
    });

    await seekTo(app, 1);

    assert.equal(app.filterCalls.length, 1);
    const payload = app.filterCalls[0];
    assert.equal(payload.mu, 0);
    assert.equal(payload.bids_root, "/data");
    assert.equal(payload.entity_label, "sub-01_task-rest");
    assert.equal(payload.view_start, 100);
    assert.equal(payload.view_end, 400);
    assert.equal(payload.use_peeloff, true);
    assert.equal(payload.lock_spikes, true);
    assert.deepEqual(payload.artifact_times, [5]);
    assert.deepEqual(payload.artifact_regions, [[1, 2]]);
    assert.equal(payload.grid_name, "Grid 1");
    assert.deepEqual(payload.inactive_mus, []);
    // The run's settings, as MUedit2's session refits with them.
    assert.equal(payload.nbextchan, 500);
    assert.equal(payload.peel_off_win, 0.03);
    assert.equal(payload.compute_dtype, "float64");

    assert.deepEqual(app.state.spikeTimes[0], [10, 25]);
    assert.deepEqual(app.state.pulseTrains[0], [0.1, 0.9]);
  });

  test("undoing update_filter restores the arrays the API replaced", async () => {
    const app = createHarness({
      updateFilter: async () => ({ spikes: [999], pulse_train: [0.42] }),
      state: oneGrid([[10, 30]], {
        pulseTrains: [[0, 1, 0, 1]],
        artifactTimes: [[5]],
        editHistory: [step({ type: "update_filter", mu: 0 })],
      }),
    });

    const before = snapshot(app.state);
    await seekTo(app, 1);
    assert.deepEqual(app.state.spikeTimes[0], [999]);
    // A logged diff cannot invert a recomputation; the undo comes from the backup.
    await seekTo(app, 0);
    assert.equal(snapshot(app.state), before);
  });

  test("a failing update_filter falls back to the logged diff and says so", async () => {
    const app = createHarness({
      updateFilter: async () => {
        throw new Error("backend down");
      },
      state: oneGrid([[10, 30]], {
        pulseTrains: [[0, 1, 0, 1]],
        editHistory: [
          step({
            type: "update_filter",
            mu: 0,
            spikesAdded: [20],
            spikesRemoved: [30],
          }),
        ],
      }),
    });

    const before = snapshot(app.state);
    await seekTo(app, 1);
    assert.deepEqual(app.state.spikeTimes[0], [10, 20]);
    assert.equal(
      app.statuses[app.statuses.length - 1],
      "Replayed step 1 of 1 from the edit log: could not recompute the filter. backend down",
    );
    await seekTo(app, 0);
    assert.equal(snapshot(app.state), before);
  });
});

describe("updateTimelineUi", () => {
  test("reflects the position on the controls", async () => {
    const app = createHarness({
      state: oneGrid([[10]], {
        editHistory: [
          step({ mu: 0, spikesAdded: [20] }),
          step({ type: "update_filter", mu: 0 }),
        ],
      }),
    });
    const { els } = app;

    assert.equal(els.timelineSlider.max, "2");
    assert.equal(els.timelineCounter.textContent, "Step 0 / 2");
    assert.equal(els.prevStepBtn.disabled, true, "nothing to go back to");
    assert.equal(els.nextStepBtn.disabled, false);

    await seekTo(app, 2);
    assert.equal(els.timelineCounter.textContent, "Step 2 / 2");
    assert.equal(els.prevStepBtn.disabled, false);
    assert.equal(els.nextStepBtn.disabled, true, "nothing left to apply");
  });

  test("draws a dot per step and counts the replayed steps' discharges", async () => {
    const app = createHarness({
      state: oneGrid([[10]], {
        editHistory: [
          step({ mu: 0, spikesAdded: [20, 40] }),
          step({ type: "update_filter", mu: 0, spikesRemoved: [10] }),
        ],
      }),
    });
    const { els } = app;
    await seekTo(app, 1);

    // The first dot is step 0, the decomposition as loaded.
    const dots = els.timelineSteps.children;
    assert.deepEqual(
      dots.map((d) => d.dataset.kind),
      ["start", "add", "update_filter"],
    );
    assert.deepEqual(
      dots.map((d) => [...d.classes]),
      [["is-done"], ["is-done", "is-current"], []],
    );
    assert.equal(els.timelineSteps.style.props["--progress"], "0.5");
    assert.equal(els.diffAdded.textContent, "+2");
    assert.equal(els.diffRemoved.textContent, "−0");

    await seekTo(app, 2);
    assert.equal(els.diffRemoved.textContent, "−1");
    assert.deepEqual(
      els.diffSquares.children.map((s) => s.dataset.kind),
      ["added", "added", "added", "removed", "removed"],
    );
  });

  test("the timeline controls are disabled when the MU has no steps", () => {
    const app = createHarness({ state: oneGrid([[10]]) });
    assert.equal(app.els.timelineSlider.disabled, true);
    assert.equal(app.els.playPauseBtn.disabled, true);
    assert.equal(app.els.timelineCounter.textContent, "Step 0 / 0");
  });
});

describe("startReplay", () => {
  test("opens on the first selectable MU of the first grid", () => {
    const app = createHarness({
      state: {
        spikeTimes: [[1], [1], [1]],
        pulseTrains: [[0], [0], [0]],
        muGridIndex: [1, 1, 0],
        muUids: ["g1_mu0", "g1_mu1", "g0_mu0"],
        gridNames: ["Grid 1", "Grid 2"],
        editHistory: [
          step({ type: "remove_duplicates", removedMuUids: ["g1_mu0"] }),
        ],
      },
    });
    // g1_mu0 is the first MU of the first grid, but the log removed it.
    assert.equal(app.state.currentGrid, 1);
    assert.equal(app.state.currentMu, 1);
    assert.equal(app.els.muSelect.value, "1");
  });
});

describe("adjustReplayView", () => {
  test("zooms around the centre and stays in bounds", () => {
    const app = createHarness({
      state: oneGrid([[10]], { pulseTrains: [new Array(1000).fill(0)] }),
    });

    app.adjustReplayView("zoom_in");
    assert.deepEqual(app.state.replayView, { start: 100, end: 900 });

    app.adjustReplayView("scroll_left");
    assert.deepEqual(app.state.replayView, { start: 60, end: 860 });

    app.adjustReplayView("zoom_out");
    app.adjustReplayView("zoom_out");
    assert.equal(app.state.replayView.start, 0);
    assert.equal(app.state.replayView.end, 1000);
  });
});
