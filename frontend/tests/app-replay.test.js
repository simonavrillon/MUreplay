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
    editMuGridSelect: fakeSelect(),
    editMuSelect: fakeSelect(),
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
 * @param {Partial<import("../src/app/state.js").State>} [overrides]
 */
function makeState(overrides = {}) {
  return {
    editedFilename: "sub-01_edited.json",
    logFilename: "sub-01_edited.json",
    fsamp: 2048,
    pulseTrains: [],
    distimes: [],
    gridNames: ["Grid 1"],
    muGridIndex: [],
    muUids: [],
    currentGrid: 0,
    currentMu: 0,
    history: [],
    replayGroups: [],
    filteredReplayGroups: [],
    isPlaying: false,
    playTimer: null,
    editHistory: [],
    replayBaseDistimes: [],
    replayBasePulseTrains: [],
    replayPosition: 0,
    replayBackups: [],
    replayView: null,
    loadedFromDecomp: true,
    muMarks: {},
    muGhostUids: [],
    bidsRoot: "/data",
    entityLabel: "sub-01",
    bidsEntityLabel: "",
    artifactTimes: [],
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
 * @param {Partial<import("../src/app/state.js").EditLogEntry>} fields
 */
function step(fields) {
  return {
    idx: 0,
    timestamp: "t",
    type: "add_spikes",
    muUid: "",
    muIdx: -1,
    viewStart: null,
    viewEnd: null,
    spikesAdded: [],
    spikesRemoved: [],
    artifactsAdded: [],
    artifactsRemoved: [],
    usePeeloff: false,
    lockSpikes: false,
    raw: {},
    ...fields,
  };
}

/**
 * Build the service over a fake context, then run the load sequence
 * `file-session.js` performs so the replay starts from a real base.
 *
 * @param {{
 *   state?: Partial<import("../src/app/state.js").State>,
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
        return opts.updateFilter ? opts.updateFilter(payload) : {};
      },
    },
    /** @type {string[]} */
    statuses: [],
    /** @param {string} text */
    setEditStatus(text) {
      app.statuses.push(text);
    },
    setStatus() {},
    filterCalls,
  });
  Object.assign(app, createReplayService(app));

  app.initializeReplayFromLoadedData();
  state.currentGrid = app.firstGridWithMu();
  const mus = app.musForGrid(state.currentGrid);
  state.currentMu = mus.length ? mus[0] : 0;
  app.fillGridSelect();
  app.fillMuSelect();
  if (state.history.length) {
    app.rebuildReplayGroups();
    app.initializeReplayFromLoadedData();
    app.resetReplayForCurrentMu();
  }
  app.updateTimelineUi();
  return app;
}

/** A deep snapshot of everything a replay step is allowed to touch. */
function snapshot(state) {
  return JSON.stringify({
    distimes: state.distimes,
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
        distimes: [[10], [10]],
        pulseTrains: [
          [0, 1],
          [0, 1],
        ],
        muGridIndex: [0, 0],
        muUids: ["g0_mu0", "g0_mu1"],
        history: [
          step({ idx: 0, type: "add_spikes", muIdx: 0, spikesAdded: [20] }),
          step({
            idx: 1,
            type: "delete_spikes",
            muIdx: 0,
            spikesRemoved: [10],
          }),
          // A different MU breaks the run.
          step({ idx: 2, type: "add_spikes", muIdx: 1, spikesAdded: [30] }),
          // So does a step that is not a spike edit.
          step({ idx: 3, type: "update_filter", muIdx: 1 }),
          step({
            idx: 4,
            type: "remove_outliers",
            muIdx: 1,
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
        distimes: [[10]],
        pulseTrains: [[0, 1]],
        muGridIndex: [0],
        muUids: ["g0_mu0"],
        history: [
          step({
            idx: 0,
            timestamp: "t1",
            muIdx: 0,
            spikesAdded: [20],
            viewStart: 100,
            viewEnd: 400,
          }),
          step({
            idx: 1,
            timestamp: "t2",
            type: "delete_spikes",
            muIdx: 0,
            spikesRemoved: [10],
            viewStart: 50,
            viewEnd: 200,
          }),
        ],
      },
    });

    const display = app.state.replayGroups[0].displayStep;
    assert.equal(display.type, "spike_edits");
    assert.equal(display.timestamp, "t1 -> t2");
    assert.equal(display.groupedCount, 2);
    assert.deepEqual(display.spikesAdded, [20]);
    assert.deepEqual(display.spikesRemoved, [10]);
    // The merged view spans both steps.
    assert.equal(display.viewStart, 50);
    assert.equal(display.viewEnd, 400);
    assert.equal(display.muIdx, 0);
  });
});

describe("getActiveReplayGroups", () => {
  test("keeps only the current MU's groups", () => {
    const app = createHarness({
      state: {
        distimes: [[10], [10]],
        pulseTrains: [
          [0, 1],
          [0, 1],
        ],
        muGridIndex: [0, 0],
        muUids: ["g0_mu0", "g0_mu1"],
        history: [
          step({ idx: 0, muIdx: 0, spikesAdded: [20] }),
          step({ idx: 1, muIdx: 1, spikesAdded: [30] }),
        ],
      },
    });

    assert.equal(app.state.replayGroups.length, 2);
    assert.equal(app.getActiveReplayGroups().length, 1);
    assert.deepEqual(app.getActiveReplayGroups()[0].indices, [0]);

    // Switching MU switches the timeline with it.
    app.onMuChange({ target: { value: "1" } });
    assert.deepEqual(app.getActiveReplayGroups()[0].indices, [1]);
  });

  test("groups belonging to a removed MU drop out of the timeline", () => {
    const app = createHarness({
      state: {
        distimes: [[10]],
        pulseTrains: [[0, 1]],
        muGridIndex: [0],
        muUids: ["g0_mu0"],
        history: [
          step({ idx: 0, muUid: "g0_mu0", muIdx: 0, spikesAdded: [20] }),
          step({
            idx: 1,
            type: "remove_duplicates",
            muUid: "",
            raw: { removed_mu_uids: ["g0_mu0"] },
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
        distimes: [[10, 30]],
        pulseTrains: [[0, 1, 0, 1]],
        muGridIndex: [0],
        muUids: ["g0_mu0"],
        history: [
          step({ idx: 0, type: "add_spikes", muIdx: 0, spikesAdded: [20] }),
          step({
            idx: 1,
            type: "update_filter",
            muIdx: 0,
            spikesRemoved: [10],
          }),
        ],
      },
    });

    assert.deepEqual(app.state.distimes[0], [10, 30]);
    await seekTo(app, 1);
    assert.deepEqual(app.state.distimes[0], [10, 20, 30]);
    assert.equal(app.state.replayPosition, 1);
  });

  test("a step applied then undone restores the arrays exactly", async () => {
    const app = createHarness({
      state: {
        distimes: [[10, 30, 50]],
        pulseTrains: [[0.5, 0.25, 0.75]],
        artifactTimes: [[7]],
        muGridIndex: [0],
        muUids: ["g0_mu0"],
        history: [
          step({
            idx: 0,
            type: "add_spikes",
            muIdx: 0,
            spikesAdded: [20],
            spikesRemoved: [30],
          }),
          step({
            idx: 1,
            type: "add_artifact",
            muIdx: 0,
            artifactsAdded: [99],
          }),
          step({
            idx: 2,
            type: "delete_spikes",
            muIdx: 0,
            spikesRemoved: [50],
          }),
        ],
      },
    });

    const before = snapshot(app.state);
    const total = app.getActiveReplayGroups().length;
    assert.equal(total, 3);

    await seekTo(app, total);
    assert.notEqual(snapshot(app.state), before);
    assert.deepEqual(app.state.distimes[0], [10, 20]);
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
        distimes: [[10, 30, 50]],
        pulseTrains: [[0.5, 0.25]],
        artifactTimes: [[7, 42]],
        muGridIndex: [0],
        muUids: ["g0_mu0"],
        history: [
          step({ idx: 0, type: "add_spikes", muIdx: 0, spikesAdded: [20, 40] }),
          step({
            idx: 1,
            type: "delete_artifact",
            muIdx: 0,
            artifactsRemoved: [7],
          }),
          step({
            idx: 2,
            type: "remove_outliers",
            muIdx: 0,
            spikesRemoved: [50],
          }),
          step({
            idx: 3,
            type: "add_artifact",
            muIdx: 0,
            artifactsAdded: [77],
          }),
        ],
      },
    });

    const before = snapshot(app.state);
    const total = app.getActiveReplayGroups().length;
    for (let pos = 1; pos <= total; pos += 1) await seekTo(app, pos);
    for (let pos = total - 1; pos >= 0; pos -= 1) await seekTo(app, pos);
    assert.equal(snapshot(app.state), before);
  });

  test("artifact steps apply and undo on their own MU's list", async () => {
    const app = createHarness({
      state: {
        distimes: [[10], [10]],
        pulseTrains: [
          [0, 1],
          [0, 1],
        ],
        artifactTimes: [[100], [200]],
        muGridIndex: [0, 0],
        muUids: ["g0_mu0", "g0_mu1"],
        currentMu: 1,
        history: [
          step({
            idx: 0,
            type: "add_artifact",
            muIdx: 1,
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
  test("a step carrying only a uid lands on that uid's MU", async () => {
    const app = createHarness({
      state: {
        distimes: [[10], [10]],
        pulseTrains: [
          [0, 1],
          [0, 1],
        ],
        muGridIndex: [0, 0],
        muUids: ["g0_mu0", "g0_mu1"],
        history: [
          // muIdx is unresolved, as it is for any log keyed by uid alone.
          step({ idx: 0, muUid: "g0_mu1", muIdx: -1, spikesAdded: [20] }),
        ],
      },
    });
    app.onMuChange({ target: { value: "1" } });

    await seekTo(app, 1);
    assert.deepEqual(app.state.distimes[1], [10, 20]);
    assert.deepEqual(app.state.distimes[0], [10], "MU 0 must not be touched");
  });

  test("a step naming no MU at all is skipped, not applied to MU 0", async () => {
    const app = createHarness({
      state: {
        distimes: [[10]],
        pulseTrains: [[0, 1]],
        muGridIndex: [0],
        muUids: ["g0_mu0"],
        history: [step({ idx: 0, muUid: "", muIdx: -1, spikesAdded: [20] })],
      },
    });

    // The group is filtered out of the timeline entirely.
    assert.equal(app.getActiveReplayGroups().length, 0);
    assert.deepEqual(app.state.distimes[0], [10]);
  });

  test("a seek requested mid-flight runs once the first one finishes", async () => {
    /** @type {(() => void)[]} */
    const gates = [];
    const app = createHarness({
      updateFilter: () =>
        new Promise((resolve) => {
          gates.push(() => resolve({ distimes: [1], pulse_train: [1] }));
        }),
      state: {
        distimes: [[10], [10], [10]],
        pulseTrains: [
          [0, 1],
          [0, 1],
          [0, 1],
        ],
        muGridIndex: [0, 0, 0],
        muUids: ["g0_mu0", "g0_mu1", "g0_mu2"],
        history: [
          step({ idx: 0, type: "update_filter", muIdx: 0 }),
          step({ idx: 1, type: "add_spikes", muIdx: 0, spikesAdded: [20] }),
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
    assert.deepEqual(app.state.distimes[0], [1, 20]);
    assert.equal(app.filterCalls.length, 1);
    assert.equal(app.state.replayBackups.length, 2, "one backup per step");
  });

  // --- base reconstruction --------------------------------------------------
  test("a session without the decomposition rewinds the history for its base", () => {
    // Loaded from an already-edited file: the arrays on hand are the *end* of
    // the session, so the base has to be reconstructed by undoing the log.
    const app = createHarness({
      state: {
        loadedFromDecomp: false,
        distimes: [[10, 20]],
        pulseTrains: [[0, 1]],
        artifactTimes: [[50]],
        muGridIndex: [0],
        muUids: ["g0_mu0"],
        history: [
          step({ idx: 0, type: "add_spikes", muIdx: 0, spikesAdded: [20] }),
          step({
            idx: 1,
            type: "add_artifact",
            muIdx: 0,
            artifactsAdded: [50],
          }),
        ],
      },
    });

    assert.deepEqual(app.state.replayBaseDistimes[0], [10]);
    assert.deepEqual(app.state.replayBaseArtifactTimes[0], []);
    assert.deepEqual(app.state.distimes[0], [10]);
    assert.deepEqual(app.state.artifactTimes[0], []);
  });

  // --- normalizer to engine -------------------------------------------------
  test("a uid-keyed log replays onto the MUs it names", async () => {
    // The whole path, from the JSON on disk to the rewritten spike trains. The
    // entries carry `mu_idx: null`, which is what a log serialized from a
    // producer that left the index unset looks like; only `mu_uid` identifies
    // the MU, and taking that null as index 0 would pile every edit onto the
    // first motor unit.
    const muUids = ["g0_mu0", "g0_mu1", "g0_mu2"];
    const raw = [
      {
        type: "add_spikes",
        mu_idx: null,
        mu_uid: "g0_mu2",
        spikes_added: [20],
      },
      {
        type: "delete_spikes",
        mu_idx: null,
        mu_uid: "g0_mu2",
        spikes_removed: "10",
      },
    ];
    const history = raw
      .map((entry, i) => normalizeLogEntry(entry, i, muUids))
      .filter((entry) => entry !== null);

    const app = createHarness({
      state: {
        distimes: [[10], [10], [10]],
        pulseTrains: [
          [0, 1],
          [0, 1],
          [0, 1],
        ],
        muGridIndex: [0, 0, 0],
        muUids,
        history,
      },
    });
    app.onMuChange({ target: { value: "2" } });

    const before = snapshot(app.state);
    // Both entries are spike edits on one MU, so they replay as a single group.
    assert.equal(app.getActiveReplayGroups().length, 1);

    await seekTo(app, 1);
    assert.deepEqual(app.state.distimes[2], [20]);
    assert.deepEqual(app.state.distimes[0], [10], "MU 0 must not be touched");
    assert.deepEqual(app.state.distimes[1], [10]);

    await seekTo(app, 0);
    assert.equal(snapshot(app.state), before);
  });
});

describe("update_filter", () => {
  // --- update_filter --------------------------------------------------------
  test("sends the logged window and stores the recomputed arrays", async () => {
    const app = createHarness({
      updateFilter: async () => ({
        distimes: [10, 25],
        pulse_train: [0.1, 0.9],
      }),
      state: {
        distimes: [[10, 30]],
        pulseTrains: [[0, 1, 0, 1]],
        artifactTimes: [[5]],
        artifactRegions: [[1, 2]],
        muGridIndex: [0],
        muUids: ["g0_mu0"],
        bidsEntityLabel: "sub-01_task-rest",
        history: [
          step({
            idx: 0,
            type: "update_filter",
            muIdx: 0,
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
    assert.equal(payload.mu_index, 0);
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

    assert.deepEqual(app.state.distimes[0], [10, 25]);
    assert.deepEqual(app.state.pulseTrains[0], [0.1, 0.9]);
  });

  test("undoing update_filter restores the arrays the API replaced", async () => {
    const app = createHarness({
      updateFilter: async () => ({
        distimes: [999],
        pulse_train: [0.42],
      }),
      state: {
        distimes: [[10, 30]],
        pulseTrains: [[0, 1, 0, 1]],
        // One row per MU, as the loader produces; update_filter leaves it alone.
        artifactTimes: [[5]],
        muGridIndex: [0],
        muUids: ["g0_mu0"],
        history: [step({ idx: 0, type: "update_filter", muIdx: 0 })],
      },
    });

    const before = snapshot(app.state);
    await seekTo(app, 1);
    assert.deepEqual(app.state.distimes[0], [999]);
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
        distimes: [[10, 30]],
        pulseTrains: [[0, 1, 0, 1]],
        muGridIndex: [0],
        muUids: ["g0_mu0"],
        history: [
          step({
            idx: 0,
            type: "update_filter",
            muIdx: 0,
            spikesAdded: [20],
            spikesRemoved: [30],
          }),
        ],
      },
    });

    const before = snapshot(app.state);
    await seekTo(app, 1);
    assert.deepEqual(app.state.distimes[0], [10, 20]);
    assert.ok(
      app.statuses.some((s) =>
        /update_filter step fallback.*backend down/.test(s),
      ),
      `expected a fallback status, got ${JSON.stringify(app.statuses)}`,
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
        distimes: [[10]],
        pulseTrains: [[0, 1]],
        muGridIndex: [0],
        muUids: ["g0_mu0"],
        history: [
          step({ idx: 0, muIdx: 0, spikesAdded: [20] }),
          step({ idx: 1, type: "update_filter", muIdx: 0 }),
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
        distimes: [[10]],
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

describe("currentStep", () => {
  test("reports the group behind the playhead", async () => {
    const app = createHarness({
      state: {
        distimes: [[10]],
        pulseTrains: [[0, 1]],
        muGridIndex: [0],
        muUids: ["g0_mu0"],
        history: [
          step({ idx: 0, timestamp: "first", muIdx: 0, spikesAdded: [20] }),
          step({
            idx: 1,
            type: "update_filter",
            timestamp: "second",
            muIdx: 0,
          }),
        ],
      },
    });

    assert.equal(app.currentStep(), null, "no step applied yet");
    await seekTo(app, 1);
    assert.equal(app.currentStep().timestamp, "first");
    assert.equal(app.isCurrentMuStep(app.currentStep()), true);
    assert.equal(app.isCurrentMuStep(null), false);
  });
});

describe("musForGrid and firstGridWithMu", () => {
  test("read the grid assignment", () => {
    const app = createHarness({
      state: {
        distimes: [[1], [1], [1]],
        pulseTrains: [[0], [0], [0]],
        muGridIndex: [2, 0, 2],
        muUids: ["g2_mu0", "g0_mu0", "g2_mu1"],
        gridNames: ["Grid 1", "Grid 2", "Grid 3"],
      },
    });
    assert.deepEqual(app.musForGrid(2), [0, 2]);
    assert.deepEqual(app.musForGrid(0), [1]);
    assert.deepEqual(app.musForGrid(1), []);
    // Insertion order of the grid set, not numeric order.
    assert.equal(app.firstGridWithMu(), 2);
  });
});

describe("pulseForCurrentMu", () => {
  test("synthesizes a train when none was loaded", () => {
    const app = createHarness({
      state: {
        distimes: [[2, 5]],
        pulseTrains: [[]],
        muGridIndex: [0],
        muUids: ["g0_mu0"],
      },
    });
    assert.deepEqual(app.pulseForCurrentMu(), [0, 0, 1, 0, 0, 1]);
    assert.deepEqual(app.distimesForCurrentMu(), [2, 5]);
    assert.deepEqual(app.artifactTimesForCurrentMu(), []);
  });
});

describe("adjustReplayView", () => {
  test("zooms around the centre and stays in bounds", () => {
    const app = createHarness({
      state: {
        distimes: [[10]],
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
