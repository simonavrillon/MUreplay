// The timeline over the server's replay: step grouping, the steps each seek sends, what
// the page does with the answer, and the pulse window it fetches.
import { test, after, describe } from "node:test";
import assert from "node:assert/strict";
import { createReplayService } from "../src/app/services/replay-service.js";
import { fakeCanvas, fakeElement, fakeSelect, installDom } from "./_dom.js";

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
    token: "t1",
    fsamp: 2048,
    totalSamples: 1000,
    spikeTimes: [],
    versions: Array.from({ length: nMu }, (_, i) => i + 1),
    pulseView: null,
    gridNames: ["Grid 1"],
    muGridIndex: [],
    muUids: [],
    currentGrid: 0,
    currentMu: 0,
    editHistory: [],
    replayGroups: [],
    timelineGroups: [],
    playTimer: null,
    replayPosition: 0,
    replayView: null,
    muMarks: {},
    muGhostUids: [],
    artifactRegions: [],
    ...overrides,
  };
}

/**
 * MUs `g0_mu<n>` on one grid, with the given discharges.
 *
 * @param {number[][]} spikeTimes
 * @param {Partial<import("../src/state/state.js").State>} [fields]
 */
function oneGrid(spikeTimes, fields = {}) {
  return {
    spikeTimes: spikeTimes.map((row) => Int32Array.from(row)),
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
 * A seek frame, decoded: `rows` maps each changed MU to its new discharges.
 *
 * @param {import("../src/state/state.js").State} state
 * @param {Record<number, number[]>} rows
 * @param {{ step: number, message: string }[]} [refitErrors]
 */
function changeFrame(state, rows, refitErrors = []) {
  const changed = Object.keys(rows).map(Number);
  return {
    meta: {
      changed,
      versions: state.versions.map((v, mu) =>
        changed.includes(mu) ? v + 10 : v,
      ),
      refit_errors: refitErrors,
    },
    spikeTimes: changed.map((mu) => Int32Array.from(rows[mu])),
  };
}

/**
 * The service over a fake context, with the replay started as `file-session.js` does.
 *
 * @param {{
 *   state?: Partial<import("../src/state/state.js").State>,
 *   seek?: (payload: any, state: any) => Promise<any> | any,
 *   canvas?: boolean,
 * }} [opts]
 */
function createHarness(opts = {}) {
  const state = makeState(opts.state);
  /** @type {any[]} */
  const seekCalls = [];
  /** @type {any[]} */
  const pulseCalls = [];
  /** @type {any[]} */
  const prepareCalls = [];
  const els = /** @type {any} */ (fakeEls());
  if (opts.canvas)
    els.editPulseCanvas = fakeCanvas({ width: 346, height: 128 });
  const app = /** @type {any} */ ({
    state,
    els,
    api: {
      /** @param {any} payload */
      replaySeek: async (payload) => {
        seekCalls.push(payload);
        if (opts.seek) return opts.seek(payload, state);
        return changeFrame(state, {});
      },
      /** @param {any} params */
      fetchPulse: async (params) => {
        pulseCalls.push(params);
        return { ...params, version: state.versions[params.mu] };
      },
      /** @param {any} payload */
      replayPrepareGrid: async (payload) => {
        prepareCalls.push(payload);
      },
    },
    /** @type {string[]} */
    statuses: [],
    /** @param {string} text */
    setReplayStatus(text) {
      app.statuses.push(text);
    },
    renderAll() {
      app.ensurePulseView();
    },
    seekCalls,
    pulseCalls,
    prepareCalls,
  });
  Object.assign(app, createReplayService(app));
  app.startReplay();
  return app;
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
  test("asks the server for the current MU's steps up to the playhead", async () => {
    const app = createHarness({
      state: oneGrid([[10], [10]], {
        editHistory: [
          step({ mu: 0, spikesAdded: [20] }),
          step({ mu: 1, spikesAdded: [30] }),
          step({ type: "delete_spikes", mu: 0, spikesRemoved: [10] }),
          step({ type: "update_filter", mu: 0 }),
        ],
      }),
    });
    // MU 0's groups: [0], [2] (MU 1's step broke the run), then [3].
    await seekTo(app, 3);
    await seekTo(app, 1);
    assert.deepEqual(
      app.seekCalls.map((c) => [c.token, c.steps]),
      [
        ["t1", [0, 2, 3]],
        ["t1", [0]],
      ],
    );
    assert.equal(app.state.replayPosition, 1);
  });

  test("shows the discharges and versions the server answers with", async () => {
    const app = createHarness({
      seek: (payload, state) =>
        changeFrame(state, payload.steps.length ? { 1: [10, 30] } : {}),
      state: oneGrid([[10], [10]], {
        currentMu: 1,
        editHistory: [step({ mu: 1, spikesAdded: [30] })],
      }),
    });
    app.onMuChange({ target: { value: "1" } });
    await flush();
    await seekTo(app, 1);
    assert.deepEqual([...app.state.spikeTimes[1]], [10, 30]);
    assert.deepEqual([...app.state.spikeTimes[0]], [10], "MU 0 is untouched");
    assert.deepEqual(app.state.versions, [1, 12]);
    assert.equal(
      app.statuses[app.statuses.length - 1],
      "Applied step 1 of 1: spike_edits.",
    );
  });

  test("changing MU takes the server back to step 0", async () => {
    const app = createHarness({
      state: oneGrid([[10], [10]], {
        editHistory: [step({ mu: 0, spikesAdded: [20] }), step({ mu: 1 })],
      }),
    });
    await seekTo(app, 1);
    app.onMuChange({ target: { value: "1" } });
    await flush();
    assert.deepEqual(
      app.seekCalls.map((c) => c.steps),
      [[0], []],
    );
    assert.equal(app.state.replayPosition, 0);
  });

  test("a step naming no MU at all is on no MU's timeline", () => {
    const app = createHarness({
      state: oneGrid([[10]], { editHistory: [step({ spikesAdded: [20] })] }),
    });
    assert.equal(app.state.timelineGroups.length, 0);
  });

  test("a seek requested mid-flight runs once the first one finishes", async () => {
    /** @type {(() => void)[]} */
    const gates = [];
    const app = createHarness({
      seek: (_payload, state) =>
        new Promise((resolve) => {
          gates.push(() => resolve(changeFrame(state, {})));
        }),
      state: oneGrid([[10]], {
        editHistory: [
          step({ type: "update_filter", mu: 0 }),
          step({ type: "update_filter", mu: 0 }),
          step({ type: "update_filter", mu: 0 }),
        ],
      }),
    });

    await seekTo(app, 1);
    await seekTo(app, 2);
    await seekTo(app, 3);
    assert.equal(app.seekCalls.length, 1, "one seek at a time");

    gates.shift()?.();
    await flush();
    // The newest target only: the one scrubbed past is dropped.
    assert.deepEqual(
      app.seekCalls.map((c) => c.steps),
      [[0], [0, 1, 2]],
    );
    gates.shift()?.();
    await flush();
    assert.equal(app.state.replayPosition, 3);
  });

  test("picking another MU mid-seek takes the server back to its step 0", async () => {
    /** @type {(() => void)[]} */
    const gates = [];
    const app = createHarness({
      seek: (payload, state) =>
        new Promise((resolve) => {
          gates.push(() =>
            resolve(
              changeFrame(
                state,
                payload.steps.length ? { 0: [10, 20] } : { 0: [10] },
              ),
            ),
          );
        }),
      state: oneGrid([[10], [10]], {
        editHistory: [
          step({ type: "update_filter", mu: 0 }),
          step({ type: "update_filter", mu: 0 }),
          step({ mu: 1 }),
        ],
      }),
    });
    await seekTo(app, 2);
    app.onMuChange({ target: { value: "1" } });
    gates.shift()?.();
    await flush();
    gates.shift()?.();
    await flush();
    assert.deepEqual(
      app.seekCalls.map((c) => c.steps),
      [[0, 1], []],
    );
    assert.equal(app.state.replayPosition, 0);
    assert.deepEqual([...app.state.spikeTimes[0]], [10]);
  });

  test("a refit replayed from the log says so, and why", async () => {
    const app = createHarness({
      seek: (_payload, state) =>
        changeFrame(state, { 0: [10, 20] }, [
          { step: 0, message: "No EMG recording for sub-1." },
        ]),
      state: oneGrid([[10]], {
        editHistory: [
          step({ type: "update_filter", mu: 0, spikesAdded: [20] }),
        ],
      }),
    });
    await seekTo(app, 1);
    assert.equal(
      app.statuses[app.statuses.length - 1],
      "Replayed step 1 of 1 from the edit log: could not recompute the filter. No EMG recording for sub-1.",
    );
  });

  test("a failed seek leaves the playhead and says why", async () => {
    const app = createHarness({
      seek: () => {
        throw new Error("This replay is no longer open; open the trial again.");
      },
      state: oneGrid([[10]], { editHistory: [step({ mu: 0 })] }),
    });
    await seekTo(app, 1);
    assert.equal(app.state.replayPosition, 0);
    assert.equal(
      app.statuses[app.statuses.length - 1],
      "Could not replay step 1: This replay is no longer open; open the trial again.",
    );
  });
});

describe("the grid's EMG", () => {
  test("is filtered ahead once, when the MU's timeline has a refit", async () => {
    const app = createHarness({
      state: oneGrid([[10], [10]], {
        editHistory: [step({ type: "update_filter", mu: 0 }), step({ mu: 1 })],
      }),
    });
    app.onMuChange({ target: { value: "1" } });
    app.onMuChange({ target: { value: "0" } });
    await flush();
    assert.deepEqual(app.prepareCalls, [{ token: "t1", grid: 0 }]);
  });
});

describe("the pulse window", () => {
  test("is fetched for the view, and again when the MU's version moves", async () => {
    const app = createHarness({
      canvas: true,
      seek: (_payload, state) => changeFrame(state, { 0: [10, 20] }),
      state: oneGrid([[10]], {
        editHistory: [step({ mu: 0, spikesAdded: [20] })],
      }),
    });
    await flush();
    assert.equal(app.pulseCalls.length, 1);
    assert.deepEqual(
      { ...app.pulseCalls[0], bins: undefined },
      { token: "t1", mu: 0, start: 0, end: 1000, bins: undefined },
    );
    assert.equal(app.state.pulseView.version, 1);

    // Drawing again with nothing moved asks for nothing.
    app.renderAll();
    await flush();
    assert.equal(app.pulseCalls.length, 1);

    await seekTo(app, 1);
    assert.equal(app.pulseCalls.length, 2);
    assert.equal(app.state.pulseView.version, 11);
  });

  test("a window of a session since replaced is dropped", async () => {
    const app = createHarness({ canvas: true, state: oneGrid([[10]]) });
    app.state.token = "t2";
    await flush();
    assert.equal(app.state.pulseView, null);
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
        spikeTimes: [[1], [1], [1]].map((row) => Int32Array.from(row)),
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
      state: oneGrid([[10]], { totalSamples: 1000 }),
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
