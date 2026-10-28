/**
 * Canvas drawing primitives, ported from MUedit2's so the replay's plots draw
 * as its edit page does: a trace over a view, with its axes, markers and
 * selections. `getCanvasPlotMetrics` and `viewScale` give the plot box and
 * its x scale, so a caller can draw more over the same pixels.
 */
import { COLORS, canvasFont } from "../config.js";
import { isEnvelope, seriesPoints, traceRange } from "../signal/series.js";

/** @typedef {import("../app/context.js").Span} Span */
/** @typedef {import("../signal/series.js").TraceWindow} TraceWindow */
/** @typedef {{ left: number, right: number, top: number, bottom: number }} Padding */
/** @typedef {HTMLCanvasElement | null | undefined} CanvasRef */
/**
 * A box over the plot: samples `[start, end)`, and pixel rows from the plot's
 * top, clamped to it.
 *
 * @typedef {Span & { yMin: number, yMax: number }} Selection
 */

/** Pixels around the plot box: the value labels on the left, the time labels below. */
export const PLOT_PADDING = { left: 38, right: 8, top: 8, bottom: 20 };

/**
 * Points drawn at sample `positions`, `values` high.
 *
 * @typedef {object} MarkerSet
 * @property {ArrayLike<number>} positions
 * @property {ArrayLike<number>} values
 * @property {string} color
 * @property {number} [radius]
 * @property {boolean} [outlined]
 */

/**
 * @typedef {object} TraceOptions
 * @property {string} [color]
 * @property {MarkerSet[]} [markers]
 * @property {Selection[]} [selections]
 * @property {{ min: number, max: number }} [range] The y range; else the row's.
 * @property {number | null} [fsamp]
 * @property {string} [noDataText]
 */

/**
 * Size a canvas's backing store to its layout box at the screen's pixel
 * density, and clear it. Drawing is then in CSS pixels, `width` x `height`.
 *
 * @param {CanvasRef} canvasEl
 * @param {{ width?: number, height?: number }} [fallback] The size while the canvas has no layout box.
 */
export function prepareCanvas(canvasEl, fallback = {}) {
  const ctx = canvasEl?.getContext("2d");
  if (!canvasEl || !ctx) return null;
  const width = canvasEl.clientWidth || fallback.width || 1;
  const height = canvasEl.clientHeight || fallback.height || 1;
  const dpr = window.devicePixelRatio || 1;
  const backingWidth = Math.round(width * dpr);
  const backingHeight = Math.round(height * dpr);
  // Assigning a size reallocates and clears the store even when it is unchanged.
  if (canvasEl.width !== backingWidth) canvasEl.width = backingWidth;
  if (canvasEl.height !== backingHeight) canvasEl.height = backingHeight;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, width, height);
  return { canvasEl, ctx, width, height };
}

/**
 * The x scale of a plot over `view`: the samples `[view.start, view.end)`
 * span `width` pixels from `left`, the first at the left edge and the last at
 * the right one. The traces, selections, time axis and overlays all use it,
 * so they line up.
 *
 * @param {Span} view
 * @param {number} left
 * @param {number} width
 */
export function viewScale(view, left, width) {
  const span = Math.max(1, view.end - view.start - 1);
  return {
    /** @param {number} sample */
    toX: (sample) => left + ((sample - view.start) / span) * width,
  };
}

/**
 * The plot box inside a canvas: gutters for the value labels on the left and
 * the time labels below.
 *
 * @param {HTMLCanvasElement} canvas
 */
export function getCanvasPlotMetrics(canvas) {
  /** @type {Padding} */
  const padding = { ...PLOT_PADDING };
  const width = canvas.clientWidth || canvas.width || 1;
  const height = canvas.clientHeight || canvas.height || 1;
  return {
    padding,
    width,
    height,
    plotWidth: Math.max(1, width - padding.left - padding.right),
    plotHeight: Math.max(1, height - padding.top - padding.bottom),
  };
}

/**
 * @param {CanvasRenderingContext2D} ctx
 * @param {number} startX
 * @param {number} endX
 * @param {Selection} sel
 * @param {Padding} padding
 * @param {number} plotHeight
 */
function drawSelectionRect(ctx, startX, endX, sel, padding, plotHeight) {
  const yMin = Math.max(0, Math.min(plotHeight, sel.yMin));
  const yMax = Math.max(0, Math.min(plotHeight, sel.yMax));
  const rectTop = padding.top + Math.min(yMin, yMax);
  const rectHeight = Math.max(1, Math.abs(yMax - yMin));
  const x = Math.min(startX, endX);
  const width = Math.max(1, Math.abs(endX - startX));
  ctx.fillStyle = COLORS.selectionFill;
  ctx.fillRect(x, rectTop, width, rectHeight);
  ctx.strokeStyle = COLORS.selectionStroke;
  ctx.lineWidth = 1;
  ctx.strokeRect(x, rectTop, width, rectHeight);
}

/**
 * Draw a series over `view`, the samples `[view.start, view.end)` of the x
 * axis. The trace may cover another window: it is drawn where its samples
 * fall, and what falls outside the view is skipped. An envelope is drawn as
 * each bin's min-max stroke, so a zoomed-out view costs two points per pixel
 * column; markers are drawn once per pixel.
 *
 * @param {CanvasRef} canvas
 * @param {TraceWindow | null} trace
 * @param {Span} view
 * @param {TraceOptions} [options]
 */
export function drawTrace(canvas, trace, view, options = {}) {
  const prepared = prepareCanvas(canvas, { height: 220 });
  if (!prepared) return;
  const { canvasEl, ctx } = prepared;

  const markers = options.markers || [];
  const viewSpan = view.end - view.start;
  if (!trace || viewSpan <= 0) {
    const noDataText = options.noDataText ?? "No data";
    if (noDataText) {
      ctx.fillStyle = COLORS.muted;
      ctx.font = canvasFont();
      ctx.fillText(noDataText, 12, 24);
    }
    return;
  }

  const fsamp = options.fsamp || null;
  const { padding, plotWidth, plotHeight } = getCanvasPlotMetrics(canvasEl);
  const { min, max } = options.range || traceRange(trace);
  const span = max - min || 1;
  const { toX } = viewScale(view, padding.left, plotWidth);
  const toY = (/** @type {number} */ v) =>
    padding.top + plotHeight - ((v - min) / span) * plotHeight;
  const inView = (/** @type {number} */ sample) =>
    sample >= view.start && sample < view.end;

  for (const sel of options.selections || []) {
    const last = view.end - 1;
    const s = Math.max(view.start, Math.min(last, sel.start));
    const e = Math.max(s, Math.min(last, sel.end));
    drawSelectionRect(ctx, toX(s), toX(e), sel, padding, plotHeight);
  }

  drawAxes(ctx, padding, plotWidth, plotHeight, min, span);
  if (fsamp) drawTimeAxis(ctx, padding, plotWidth, plotHeight, view, fsamp);

  const row = trace.row;
  if (row && seriesPoints(row)) {
    ctx.strokeStyle = options.color || COLORS.pulseTrain;
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    let started = false;
    /** @param {number} x @param {number} y */
    const to = (x, y) => {
      if (started) ctx.lineTo(x, y);
      else ctx.moveTo(x, y);
      started = true;
    };
    const n = seriesPoints(row);
    const traceSpan = trace.end - trace.start;
    if (isEnvelope(row)) {
      for (let i = 0; i < n; i++) {
        const first = trace.start + Math.floor((i * traceSpan) / n);
        const next = trace.start + Math.floor(((i + 1) * traceSpan) / n);
        const at = (first + next - 1) / 2;
        if (!inView(at)) continue;
        to(toX(at), toY(row.max[i]));
        ctx.lineTo(toX(at), toY(row.min[i]));
      }
    } else {
      for (let i = 0; i < n; i++) {
        const at = trace.start + i;
        if (inView(at)) to(toX(at), toY(row[i]));
      }
    }
    ctx.stroke();
  }

  for (const set of markers) {
    ctx.fillStyle = set.color;
    if (set.outlined) {
      ctx.strokeStyle = COLORS.markerOutline;
      ctx.lineWidth = 1;
    }
    // Each marker is its own small path: one path of many overlapping
    // circles fills several times slower in Chromium.
    /** @type {Set<number>} */
    const drawn = new Set();
    for (let i = 0; i < set.positions.length; i++) {
      const m = set.positions[i];
      if (!inView(m)) continue;
      const x = Math.min(padding.left + plotWidth, toX(m));
      const y = toY(set.values[i]);
      const pixel = Math.round(x) * 0x10000 + (Math.round(y) & 0xffff);
      if (drawn.has(pixel)) continue;
      drawn.add(pixel);
      ctx.beginPath();
      ctx.arc(x, y, set.radius ?? 3, 0, Math.PI * 2);
      ctx.fill();
      if (set.outlined) ctx.stroke();
    }
  }
}

/**
 * The plot's axis lines, and four y ticks from `min` to `min + span`.
 *
 * @param {CanvasRenderingContext2D} ctx
 * @param {Padding} padding
 * @param {number} plotWidth
 * @param {number} plotHeight
 * @param {number} min
 * @param {number} span
 */
function drawAxes(ctx, padding, plotWidth, plotHeight, min, span) {
  ctx.strokeStyle = COLORS.axis;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(padding.left, padding.top);
  ctx.lineTo(padding.left, padding.top + plotHeight);
  ctx.lineTo(padding.left + plotWidth, padding.top + plotHeight);
  ctx.stroke();

  ctx.fillStyle = COLORS.muted;
  ctx.font = canvasFont();
  const yTicks = 3;
  for (let i = 0; i <= yTicks; i++) {
    const t = i / yTicks;
    const y = padding.top + plotHeight - t * plotHeight;
    const value = min + t * span;
    ctx.strokeStyle = COLORS.gridline;
    ctx.beginPath();
    ctx.moveTo(padding.left, y);
    ctx.lineTo(padding.left + plotWidth, y);
    ctx.stroke();
    ctx.fillStyle = COLORS.muted;
    ctx.textAlign = "right";
    // The lowest label sits above the x axis, clear of the first time label.
    ctx.fillText(`${value.toFixed(1)}`, padding.left - 8, i ? y + 3 : y - 2);
  }
  ctx.textAlign = "start";
}

/** How near an edge of the plot a time label is aligned to its tick from inside, not centred. */
const TIME_LABEL_EDGE = 12;

/**
 * A time label as precise as its step: "0.5s", "12s", or "2:00" from a
 * minute up.
 *
 * @param {number} t Seconds.
 * @param {number} step
 */
function timeLabel(t, step) {
  if (step < 1) return `${t.toFixed(1)}s`;
  const s = Math.round(t);
  if (step < 60) return `${s}s`;
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

/**
 * Time labels at a round step, over the samples of `view`.
 *
 * @param {CanvasRenderingContext2D} ctx
 * @param {Padding} padding
 * @param {number} plotWidth
 * @param {number} plotHeight
 * @param {Span} view
 * @param {number} fsamp
 */
function drawTimeAxis(ctx, padding, plotWidth, plotHeight, view, fsamp) {
  const { toX } = viewScale(view, padding.left, plotWidth);
  const duration = (view.end - view.start) / fsamp;
  // Up to 10 min a step, so even an hour-long recording shown whole keeps
  // its labels apart.
  const targets = [0.1, 0.2, 0.5, 1, 2, 5, 10, 20, 30, 60, 120, 300, 600];
  const desired = duration / 5;
  let step = targets[targets.length - 1];
  for (const cand of targets) {
    if (cand >= desired) {
      step = cand;
      break;
    }
  }
  const tStart = view.start / fsamp;
  const tEnd = view.end / fsamp;
  const first = Math.ceil(tStart / step) * step;
  ctx.fillStyle = COLORS.muted;
  ctx.font = canvasFont();
  for (let t = first; t <= tEnd; t += step) {
    const x = toX(t * fsamp);
    ctx.strokeStyle = COLORS.gridline;
    ctx.beginPath();
    ctx.moveTo(x, padding.top);
    ctx.lineTo(x, padding.top + plotHeight);
    ctx.stroke();
    // Centred on its tick; one at an edge of the plot stays inside it.
    if (x - padding.left < TIME_LABEL_EDGE) ctx.textAlign = "left";
    else if (padding.left + plotWidth - x < TIME_LABEL_EDGE)
      ctx.textAlign = "right";
    else ctx.textAlign = "center";
    ctx.fillText(timeLabel(t, step), x, padding.top + plotHeight + 12);
  }
  ctx.textAlign = "start";
}
