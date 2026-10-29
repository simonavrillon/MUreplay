// The replay renderer: what the plots and the timeline bar show of the current MU and step.
import { test, after, describe } from "node:test";
import assert from "node:assert/strict";
import { normalizeLogEntry } from "../src/api/payloads.js";
import { fakeCanvas, installDom } from "./_dom.js";

const saved = { window: globalThis.window, document: globalThis.document };
installDom();
after(() => Object.assign(globalThis, saved));
const { COLORS } = await import("../src/config.js");
const { state: defaultState } = await import("../src/state/state.js");
const { PLOT_PADDING } = await import("../src/view/plots.js");
const { createReplayRenderer } = await import("../src/view/replay-renderer.js");

/**
 * A 1000-sample MU whose timeline bar is 1000 px wide, one sample per pixel.
 *
 * @param {Record<string, any>} logEntry
 */
function render(logEntry) {
  const step = normalizeLogEntry(logEntry, ["g0_mu0"]);
  assert.ok(step);
  const state = {
    ...structuredClone(defaultState),
    fsamp: 1000,
    muUids: ["g0_mu0"],
    muGridIndex: [0],
    totalSamples: 1000,
    spikeTimes: [Int32Array.from([100, 200, 300])],
    timelineGroups: [{ indices: [0], type: step.type, displayStep: step }],
    replayPosition: 1,
  };
  const els = {
    editPulseCanvas: fakeCanvas({ width: 346, height: 128 }),
    editDrCanvas: fakeCanvas({ width: 346, height: 128 }),
    editTimelineCanvas: fakeCanvas({ width: 1046, height: 20 }),
  };
  createReplayRenderer({
    els: /** @type {any} */ (els),
    state: /** @type {any} */ (state),
  }).renderAll();
  return els;
}

/** @param {ReturnType<typeof fakeCanvas>} canvas @param {string} style */
const tickXs = (canvas, style) =>
  canvas.ctx.calls
    .filter((c) => c.op === "fillRect" && c.fillStyle === style)
    .map((c) => c.args[0] - PLOT_PADDING.left);

describe("the timeline bar", () => {
  test("ticks the step's added and removed discharges", () => {
    const els = render({
      type: "add_spikes",
      mu_uid: "g0_mu0",
      spikes_added: [200],
      spikes_removed: [400],
    });
    assert.deepEqual(
      tickXs(els.editTimelineCanvas, COLORS.timelineAdded),
      [200],
    );
    assert.deepEqual(
      tickXs(els.editTimelineCanvas, COLORS.timelineRemoved),
      [400],
    );
    assert.deepEqual(
      tickXs(els.editTimelineCanvas, COLORS.timelineSpikes),
      [100, 200, 300],
    );
  });

  test("ticks the step's artifact markers, as MUedit2 does", () => {
    const els = render({
      type: "add_artifact",
      mu_uid: "g0_mu0",
      artifacts_added: [500],
    });
    assert.deepEqual(
      tickXs(els.editTimelineCanvas, COLORS.timelineAdded),
      [500],
    );
  });
});

describe("the pulse train plot", () => {
  test("draws the window the server sent, with its discharges at their values", () => {
    const step = normalizeLogEntry({ type: "flag_mu", mu_uid: "g0_mu0" }, [
      "g0_mu0",
    ]);
    const state = {
      ...structuredClone(defaultState),
      fsamp: 1000,
      token: "t",
      totalSamples: 1000,
      muUids: ["g0_mu0"],
      muGridIndex: [0],
      spikeTimes: [Int32Array.from([100])],
      timelineGroups: [{ indices: [0], type: step.type, displayStep: step }],
      pulseView: {
        mu: 0,
        start: 0,
        end: 1000,
        bins: 2,
        version: 1,
        row: {
          min: Float32Array.from([0, 0]),
          max: Float32Array.from([1, 0.5]),
        },
        spikes: Int32Array.from([100]),
        spikeValues: Float32Array.from([1]),
        artifacts: new Int32Array(0),
        artifactValues: new Float32Array(0),
      },
    };
    const canvas = fakeCanvas({ width: 346, height: 128 });
    createReplayRenderer({
      els: /** @type {any} */ ({
        editPulseCanvas: canvas,
        editDrCanvas: fakeCanvas({ width: 346, height: 128 }),
        editTimelineCanvas: fakeCanvas({ width: 1046, height: 20 }),
      }),
      state: /** @type {any} */ (state),
    }).renderAll();
    const calls = canvas.ctx.calls;
    // Each bin is one min-max stroke.
    assert.equal(calls.filter((c) => c.op === "lineTo").length >= 2, true);
    const dots = calls.filter(
      (c) => c.op === "arc" && c.fillStyle === COLORS.discharge,
    );
    assert.equal(dots.length, 1);
  });
});

describe("the discharge rate plot", () => {
  test("puts one dot between each pair of discharges, at its rate", () => {
    const els = render({ type: "flag_mu", mu_uid: "g0_mu0" });
    const arcs = els.editDrCanvas.ctx.calls.filter(
      (c) => c.op === "arc" && c.fillStyle === COLORS.discharge,
    );
    // Discharges 100 samples apart at 1000 Hz: 10 pps, the top of the plot.
    assert.equal(arcs.length, 2);
    assert.deepEqual(
      arcs.map((c) => c.args[1]),
      [8, 8],
    );
  });
});
