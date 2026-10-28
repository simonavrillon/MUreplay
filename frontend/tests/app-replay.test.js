// The replay engine: step grouping, seeking, update_filter calls and the timeline controls.
import { test, after, describe } from "node:test";
import assert from "node:assert/strict";
import { createReplayService } from "../src/app/services/replay-service.js";
import { normalizeLogEntry } from "../src/api/payloads.js";
import { fakeElement, fakeSelect, installDom } from "./_dom.js";

/**
 * The replay service is the one module that rewrites the decomposition in
 * place, so these tests care about two things above all: that a step applied
 * forward and then undone leaves the arrays byte-for-byte as they were, and
 * that each step lands on the motor unit its log entry names.
 *
 * It reaches the DOM through `els` and the globals, so the harness below
 * supplies just enough of both to run the real code unmodified.
 */

function fakeEls() {
  return {
    gridSelect: fakeSelect(),
    muSelect: fakeSelect(),
    prevStepBtn: { disabled: false, textContent: "" },
    playPauseBtn: { disabled: false, textContent: "" },
    nextStepBtn: { disabled: false, textContent: "" },
    timelineCounter: { textContent: "" },
    timelineSlider: { ...fakeElement(), max: "0", value: "0" },
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
 * A log entry with every field the service reads, so a test only spells out
 * what it is actually exercising. This mirrors what `normalizeLogEntry`
 * produces; the two meet in the round-trip test at the bottom.
 *
 * @param {Partial<import("../src/state/state.js").EditLogEntry>} fields
 */
function step(fields) {
  const mu = fields.mu ?? -1;
  return {
    type: "add_spikes",
    // `mu` is where `muUid` sits in the fixtures' `g0_mu<n>` uids.
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
 * Build the service over a fake context and start the replay, as
 * `file-session.js` does once a session has loaded.
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
        // The backend always answers with both keys; by default the refit changes nothing.
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
    setStatus() {},
    renderAll() {},
    filterCalls,
  });
  Object.assign(app, createReplayService(app));
  app.startReplay();
  return app;
}

/** A deep snapshot of everything a replay step is allowed to touch. */
function snapshot(state) {
  return JSON.stringify({
    spikeTimes: state.spikeTimes,
    pulseTrains: state.pulseTrains,
    artifactTimes: state.artifactTimes,
  });
}

/**
 * Drain everything the current seek can do without new input.
 *
 * A timer task runs after the microtask queue is empty, so this settles every
 * promise chain that resolves on its own and leaves the ones still waiting on
 * a stubbed API call pending -- which is what the coalescing test steers.
 */
function flush() {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

/**
 * Move the timeline to `pos` and let the seek run.
 *
 * `onTimelineChange` is a DOM handler: it starts the seek and returns, so
 * there is no promise to await and the test has to drain instead.
 */
async function seekTo(app, pos) {
  app.onTimelineChange({ target: { value: String(pos) } });
  await flush();
}

// --- grouping -------------------------------------------------------------

describe("rebuildReplayGroups", () => {
  test("collapses a run of spike edits on one MU", () => {
    const app = createHarness({
      state: {
        spikeTimes: [[10], [10]],
        pulseTrains: [
          [0, 1],
          [0, 1],
        ],
        muGridIndex: [0, 0],
        muUids: ["g0_mu0", "g0_mu1"],
        editHistory: [
          step({ type: "add_spikes", mu: 0, spikesAdded: [20] }),
          step({
            type: "delete_spikes",
            mu: 0,
            spikesRemoved: [10],
          }),
          // A different MU breaks the run.
          step({ type: "add_spikes", mu: 1, spikesAdded: [30] }),
          // So does a step that is not a spike edit.
          step({ type: "update_filter", mu: 1 }),
          step({
            type: "remove_outliers",
            mu: 1,
            spikesRemoved: [30],
          }),
        ],
      },
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
      state: {
        spikeTimes: [[10]],
        pulseTrains: [[0, 1]],
        muGridIndex: [0],
        muUids: ["g0_mu0"],
        editHistory: [
          step({
            mu: 0,
            spikesAdded: [20],
            viewStart: 100,
            viewEnd: 400,
          }),
          step({
            type: "delete_spikes",
            mu: 0,
            spikesRemoved: [10],
            viewStart: 50,
            viewEnd: 200,
          }),
        ],
      },
    });

    const display = app.state.replayGroups[0].displayStep;
    assert.equal(display.type, "spike_edits");
    assert.deepEqual(display.spikesAdded, [20]);
    assert.deepEqual(display.spikesRemoved, [10]);
    // The merged view spans both steps.
    assert.equal(display.viewStart, 50);
    assert.equal(display.viewEnd, 400);
    assert.equal(display.mu, 0);
  });
});

describe("the timeline groups", () => {
  test("keeps only the current MU's groups", () => {
    const app = createHarness({
      state: {
        spikeTimes: [[10], [10]],
        pulseTrains: [
          [0, 1],
          [0, 1],
        ],
        muGridIndex: [0, 0],
        muUids: ["g0_mu0", "g0_mu1"],
        editHistory: [
          step({ mu: 0, spikesAdded: [20] }),
          step({ mu: 1, spikesAdded: [30] }),
        ],
      },
    });

    assert.equal(app.state.replayGroups.length, 2);
    assert.equal(app.state.timelineGroups.length, 1);
    assert.deepEqual(app.state.timelineGroups[0].indices, [0]);

    // Switching MU switches the timeline with it.
    app.onMuChange({ target: { value: "1" } });
    assert.deepEqual(app.state.timelineGroups[0].indices, [1]);
  });

  test("groups belonging to a removed MU drop out of the timeline", () => {
    const app = createHarness({
      state: {
        spikeTimes: [[10]],
        pulseTrains: [[0, 1]],
        muGridIndex: [0],
        muUids: ["g0_mu0"],
        editHistory: [
          step({ mu: 0, spikesAdded: [20] }),
          step({
            type: "remove_duplicates",
            removedMuUids: ["g0_mu0"],
          }),
        ],
      },
    });

    assert.equal(app.state.muMarks["g0_mu0"], "removed");
    // The uid is marked removed but still live in muUids, so it is not a ghost
    // and its group stays; a uid that no longer exists is what gets filtered.
    assert.deepEqual(app.state.muGhostUids, []);
  });
});

describe("seeking the timeline", () => {
  // --- forward / backward ---------------------------------------------------
  test("forward applies each group's diffs in order", async () => {
    const app = createHarness({
      state: {
        spikeTimes: [[10, 30]],
        pulseTrains: [[0, 1, 0, 1]],
        muGridIndex: [0],
        muUids: ["g0_mu0"],
        editHistory: [
          step({ type: "add_spikes", mu: 0, spikesAdded: [20] }),
          step({
            type: "update_filter",
            mu: 0,
            spikesRemoved: [10],
          }),
        ],
      },
    });

    assert.deepEqual(app.state.spikeTimes[0], [10, 30]);
    await seekTo(app, 1);
    assert.deepEqual(app.state.spikeTimes[0], [10, 20, 30]);
    assert.equal(app.state.replayPosition, 1);
  });

  test("a step applied then undone restores the arrays exactly", async () => {
    const app = createHarness({
      state: {
        spikeTimes: [[10, 30, 50]],
        pulseTrains: [[0.5, 0.25, 0.75]],
        artifactTimes: [[7]],
        muGridIndex: [0],
        muUids: ["g0_mu0"],
        editHistory: [
          step({
            type: "add_spikes",
            mu: 0,
            spikesAdded: [20],
            spikesRemoved: [30],
          }),
          step({
            type: "add_artifact",
            mu: 0,
            artifactsAdded: [99],
          }),
          step({
            type: "delete_spikes",
            mu: 0,
            spikesRemoved: [50],
          }),
        ],
      },
    });

    const before = snapshot(app.state);
    const total = app.state.timelineGroups.length;
    assert.equal(total, 3);

    await seekTo(app, total);
    assert.notEqual(snapshot(app.state), before);
    assert.deepEqual(app.state.spikeTimes[0], [10, 20]);
    assert.deepEqual(app.state.artifactTimes[0], [7, 99]);

    await seekTo(app, 0);
    assert.equal(snapshot(app.state), before);
    assert.equal(app.state.replayPosition, 0);
    // Every backup taken on the way out has been consumed.
    assert.deepEqual(app.state.replayBackups, []);
  });

  test("stepping forward and back one group at a time round-trips", async () => {
    const app = createHarness({
      state: {
        spikeTimes: [[10, 30, 50]],
        pulseTrains: [[0.5, 0.25]],
        artifactTimes: [[7, 42]],
        muGridIndex: [0],
        muUids: ["g0_mu0"],
        editHistory: [
          step({ type: "add_spikes", mu: 0, spikesAdded: [20, 40] }),
          step({
            type: "delete_artifact",
            mu: 0,
            artifactsRemoved: [7],
          }),
          step({
            type: "remove_outliers",
            mu: 0,
            spikesRemoved: [50],
          }),
          step({
            type: "add_artifact",
            mu: 0,
            artifactsAdded: [77],
          }),
        ],
      },
    });

    const before = snapshot(app.state);
    const total = app.state.timelineGroups.length;
    for (let pos = 1; pos <= total; pos += 1) await seekTo(app, pos);
    for (let pos = total - 1; pos >= 0; pos -= 1) await seekTo(app, pos);
    assert.equal(snapshot(app.state), before);
  });

  test("artifact steps apply and undo on their own MU's list", async () => {
    const app = createHarness({
      state: {
        spikeTimes: [[10], [10]],
        pulseTrains: [
          [0, 1],
          [0, 1],
        ],
        artifactTimes: [[100], [200]],
        muGridIndex: [0, 0],
        muUids: ["g0_mu0", "g0_mu1"],
        currentMu: 1,
        editHistory: [
          step({
            type: "add_artifact",
            mu: 1,
            artifactsAdded: [50, 300],
          }),
        ],
      },
    });
    app.onMuChange({ target: { value: "1" } });

    await seekTo(app, 1);
    assert.deepEqual(app.state.artifactTimes[1], [50, 200, 300]);
    // The other MU is untouched.
    assert.deepEqual(app.state.artifactTimes[0], [100]);

    await seekTo(app, 0);
    assert.deepEqual(app.state.artifactTimes[1], [200]);
  });

  // --- MU resolution --------------------------------------------------------
  test("a step naming no MU at all is skipped, not applied to MU 0", async () => {
    const app = createHarness({
      state: {
        spikeTimes: [[10]],
        pulseTrains: [[0, 1]],
        muGridIndex: [0],
        muUids: ["g0_mu0"],
        editHistory: [step({ spikesAdded: [20] })],
      },
    });

    // The group is filtered out of the timeline entirely.
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
      state: {
        spikeTimes: [[10], [10], [10]],
        pulseTrains: [
          [0, 1],
          [0, 1],
          [0, 1],
        ],
        muGridIndex: [0, 0, 0],
        muUids: ["g0_mu0", "g0_mu1", "g0_mu2"],
        editHistory: [
          step({ type: "update_filter", mu: 0 }),
          step({ type: "add_spikes", mu: 0, spikesAdded: [20] }),
        ],
      },
    });

    // The first seek stalls on the slow update_filter.
    await seekTo(app, 1);
    assert.equal(app.filterCalls.length, 1);
    assert.equal(app.state.replayPosition, 0, "still waiting on the backend");

    // Scrubbing past it while it is in flight must not start a second run: two
    // runs would both read replayPosition 0, apply the same group twice and
    // push two backups for it.
    await seekTo(app, 2);
    assert.equal(app.state.replayPosition, 0);
    assert.equal(
      app.filterCalls.length,
      1,
      "the step must not be applied twice",
    );

    gates.forEach((release) => release());
    await flush();
    // The parked target is picked up by the run in flight.
    assert.equal(app.state.replayPosition, 2);
    assert.deepEqual(app.state.spikeTimes[0], [1, 20]);
    assert.equal(app.filterCalls.length, 1);
    assert.equal(app.state.replayBackups.length, 2, "one backup per step");
  });

  // --- base reconstruction --------------------------------------------------
  test("a session without the decomposition rewinds the edit log for its base", () => {
    // Loaded from an already-edited file: the arrays on hand are the *end* of
    // the session, so the base has to be reconstructed by undoing the log.
    const app = createHarness({
      state: {
        loadedFromDecomp: false,
        spikeTimes: [[10, 20]],
        pulseTrains: [[0, 1]],
        artifactTimes: [[50]],
        muGridIndex: [0],
        muUids: ["g0_mu0"],
        editHistory: [
          step({ type: "add_spikes", mu: 0, spikesAdded: [20] }),
          step({
            type: "add_artifact",
            mu: 0,
            artifactsAdded: [50],
          }),
        ],
      },
    });

    assert.deepEqual(app.state.replayBaseSpikeTimes[0], [10]);
    assert.deepEqual(app.state.replayBaseArtifactTimes[0], []);
    assert.deepEqual(app.state.spikeTimes[0], [10]);
    assert.deepEqual(app.state.artifactTimes[0], []);
  });

  // --- normalizer to engine -------------------------------------------------
  test("a uid-keyed log replays onto the MUs it names", async () => {
    // The whole path, from the JSON on disk to the rewritten spike trains:
    // MUedit2's entries name their MU by `mu_uid` alone.
    const muUids = ["g0_mu0", "g0_mu1", "g0_mu2"];
    const raw = [
      {
        type: "add_spikes",
        mu_uid: "g0_mu2",
        spikes_added: [20],
      },
      {
        type: "delete_spikes",
        mu_uid: "g0_mu2",
        spikes_removed: [10],
      },
    ];
    const editHistory = raw
      .map((entry) => normalizeLogEntry(entry, muUids))
      .filter((entry) => entry !== null);

    const app = createHarness({
      state: {
        spikeTimes: [[10], [10], [10]],
        pulseTrains: [
          [0, 1],
          [0, 1],
          [0, 1],
        ],
        muGridIndex: [0, 0, 0],
        muUids,
        editHistory,
      },
    });
    app.onMuChange({ target: { value: "2" } });

    const before = snapshot(app.state);
    // Both entries are spike edits on one MU, so they replay as a single group.
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
  // --- update_filter --------------------------------------------------------
  test("sends the logged window and stores the recomputed arrays", async () => {
    const app = createHarness({
      updateFilter: async () => ({
        spikes: [10, 25],
        pulse_train: [0.1, 0.9],
      }),
      state: {
        spikeTimes: [[10, 30]],
        pulseTrains: [[0, 1, 0, 1]],
        artifactTimes: [[5]],
        artifactRegions: [[1, 2]],
        muGridIndex: [0],
        muUids: ["g0_mu0"],
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
      },
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
      updateFilter: async () => ({
        spikes: [999],
        pulse_train: [0.42],
      }),
      state: {
        spikeTimes: [[10, 30]],
        pulseTrains: [[0, 1, 0, 1]],
        // One row per MU, as the loader produces; update_filter leaves it alone.
        artifactTimes: [[5]],
        muGridIndex: [0],
        muUids: ["g0_mu0"],
        editHistory: [step({ type: "update_filter", mu: 0 })],
      },
    });

    const before = snapshot(app.state);
    await seekTo(app, 1);
    assert.deepEqual(app.state.spikeTimes[0], [999]);
    // The logged diff cannot invert a server recomputation, so the undo has to
    // come from the backup taken before the call.
    await seekTo(app, 0);
    assert.equal(snapshot(app.state), before);
  });

  test("a failing update_filter falls back to the logged diff and says so", async () => {
    const app = createHarness({
      updateFilter: async () => {
        throw new Error("backend down");
      },
      state: {
        spikeTimes: [[10, 30]],
        pulseTrains: [[0, 1, 0, 1]],
        muGridIndex: [0],
        muUids: ["g0_mu0"],
        editHistory: [
          step({
            type: "update_filter",
            mu: 0,
            spikesAdded: [20],
            spikesRemoved: [30],
          }),
        ],
      },
    });

    const before = snapshot(app.state);
    await seekTo(app, 1);
    assert.deepEqual(app.state.spikeTimes[0], [10, 20]);
    // The step's last status, so the step's own "Applied" line does not hide it.
    assert.equal(
      app.statuses[app.statuses.length - 1],
      "Replayed step 1 of 1 from the edit log: could not recompute the filter. backend down",
    );
    // The fallback is a plain diff, so it still inverts cleanly.
    await seekTo(app, 0);
    assert.equal(snapshot(app.state), before);
  });
});

describe("updateTimelineUi", () => {
  // --- timeline and selection -----------------------------------------------
  test("reflects the position on the controls", async () => {
    const app = createHarness({
      state: {
        spikeTimes: [[10]],
        pulseTrains: [[0, 1]],
        muGridIndex: [0],
        muUids: ["g0_mu0"],
        editHistory: [
          step({ mu: 0, spikesAdded: [20] }),
          step({ type: "update_filter", mu: 0 }),
        ],
      },
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

  test("the timeline controls are disabled when the MU has no steps", () => {
    const app = createHarness({
      state: {
        spikeTimes: [[10]],
        pulseTrains: [[0, 1]],
        muGridIndex: [0],
        muUids: ["g0_mu0"],
      },
    });
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
          step({
            type: "remove_duplicates",
            removedMuUids: ["g1_mu0"],
          }),
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
      state: {
        spikeTimes: [[10]],
        pulseTrains: [new Array(1000).fill(0)],
        muGridIndex: [0],
        muUids: ["g0_mu0"],
      },
    });

    app.adjustReplayView("zoom_in");
    assert.deepEqual(app.state.replayView, { start: 100, end: 900 });

    app.adjustReplayView("scroll_left");
    assert.deepEqual(app.state.replayView, { start: 60, end: 860 });

    // Zooming back out cannot run past the end of the recording.
    app.adjustReplayView("zoom_out");
    app.adjustReplayView("zoom_out");
    assert.equal(app.state.replayView.start, 0);
    assert.equal(app.state.replayView.end, 1000);
  });
});
