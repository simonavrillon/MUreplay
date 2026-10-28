// Canvas drawing primitives: the x and y scale, markers, selections and the empty plot.
import { test, after, describe } from "node:test";
import assert from "node:assert/strict";
import { fakeCanvas, installDom } from "./_dom.js";

const saved = { window: globalThis.window, document: globalThis.document };
installDom();
after(() => Object.assign(globalThis, saved));
const { COLORS } = await import("../src/config.js");
const { drawSeries } = await import("../src/view/plots.js");

// A canvas whose plot is 300 x 100 px, at (38, 8) inside the axis gutters.
const plotCanvas = () => fakeCanvas({ width: 346, height: 128 });
const range = { min: 0, max: 10 };
const fsamp = 2048;

/** @param {ReturnType<typeof fakeCanvas>} canvas @param {string} op @param {string} style */
const callsOf = (canvas, op, style) =>
  canvas.ctx.calls.filter(
    (c) => c.op === op && (c.fillStyle === style || c.strokeStyle === style),
  );

describe("drawSeries", () => {
  test("maps the view's first sample to the left edge and its last to the right", () => {
    const canvas = plotCanvas();
    const plot = drawSeries(
      /** @type {any} */ (canvas),
      { start: 10, end: 13 },
      { range, fsamp },
    );
    assert.ok(plot);
    assert.equal(plot.toX(10), 38);
    assert.equal(plot.toX(12), 338);
  });

  test("puts the range's min at the bottom and its max at the top", () => {
    const canvas = plotCanvas();
    const values = [100, 0, 10, 5, -100];
    drawSeries(
      /** @type {any} */ (canvas),
      { start: 1, end: 4 },
      {
        line: { values, color: COLORS.pulseTrain },
        range,
        fsamp,
      },
    );
    const points = canvas.ctx.calls
      .filter((c) => c.op === "moveTo" || c.op === "lineTo")
      .filter((c) => c.strokeStyle === COLORS.pulseTrain)
      .map((c) => c.args);
    assert.deepEqual(points, [
      [38, 108],
      [188, 8],
      [338, 58],
    ]);
  });

  test("fills a selection once, whether or not the plot is zoomed", () => {
    for (const view of [
      { start: 0, end: 100 },
      { start: 20, end: 60 },
    ]) {
      const canvas = plotCanvas();
      drawSeries(/** @type {any} */ (canvas), view, {
        selections: [{ start: 30, end: 50 }],
        range,
        fsamp,
      });
      assert.equal(callsOf(canvas, "fillRect", COLORS.selectionFill).length, 1);
    }
  });

  test("draws only the markers in view, at their values", () => {
    const canvas = plotCanvas();
    drawSeries(
      /** @type {any} */ (canvas),
      { start: 0, end: 11 },
      {
        range,
        fsamp,
        markers: [
          { positions: [5, 20], values: [10, 3], color: COLORS.discharge },
        ],
      },
    );
    const arcs = callsOf(canvas, "arc", COLORS.discharge);
    assert.deepEqual(
      arcs.map((c) => c.args.slice(0, 3)),
      [[188, 8, 3]],
    );
  });

  test("an empty view says No data and returns no plot", () => {
    const canvas = plotCanvas();
    const plot = drawSeries(
      /** @type {any} */ (canvas),
      { start: 0, end: 0 },
      { range, fsamp },
    );
    assert.equal(plot, null);
    const texts = canvas.ctx.calls.filter((c) => c.op === "fillText");
    assert.deepEqual(
      texts.map((c) => c.args[0]),
      ["No data"],
    );
  });
});
