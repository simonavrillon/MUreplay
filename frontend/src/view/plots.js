/**
 * Canvas drawing primitives: a series over a view, with its axes, markers and
 * selections. `drawSeries` returns the plot box and its scale, so a caller can
 * draw more over the same pixels.
 */

import { COLORS, canvasFont } from "../config.js";

/** @typedef {import("../app/context.js").Span} Span */

/** Pixels around the plot box: the value labels on the left, the time labels below. */
export const PLOT_PADDING = { left: 38, right: 8, top: 8, bottom: 20 };

/**
 * Points drawn at sample `positions`, `values` high.
 *
 * @typedef {object} MarkerSet
 * @property {number[]} positions
 * @property {number[]} values
 * @property {string} color
 * @property {number} [radius]
 * @property {boolean} [outlined]
 */

/**
 * @typedef {object} SeriesOptions
 * @property {{ values: number[], color: string }} [line] A trace through every sample.
 * @property {MarkerSet[]} [markers]
 * @property {Span[]} [selections]
 * @property {{ min: number, max: number }} range The y range.
 * @property {number} fsamp
 */

/**
 * The plot box a series was drawn in, and its scale.
 *
 * @typedef {object} PlotBox
 * @property {CanvasRenderingContext2D} ctx
 * @property {number} top
 * @property {number} height
 * @property {(sample: number) => number} toX
 */

/**
 * Draw the samples `[view.start, view.end)`: the first at the plot's left edge,
 * the last at its right one. An empty view says "No data".
 *
 * @param {HTMLCanvasElement} canvasEl
 * @param {Span} view
 * @param {SeriesOptions} options
 * @returns {PlotBox | null}
 */
export function drawSeries(canvasEl, view, options) {
  const ctx = canvasEl.getContext("2d");
  if (!ctx) return null;
  const w = canvasEl.clientWidth || canvasEl.width || 1;
  canvasEl.width = w;
  const h = canvasEl.clientHeight || canvasEl.height || 220;
  canvasEl.height = h;
  ctx.clearRect(0, 0, w, h);

  if (view.end <= view.start) {
    ctx.fillStyle = COLORS.muted;
    ctx.font = canvasFont();
    ctx.fillText("No data", 12, 24);
    return null;
  }

  const { line, fsamp } = options;
  const { min, max } = options.range;
  const padding = PLOT_PADDING;
  const plotWidth = Math.max(1, w - padding.left - padding.right);
  const plotHeight = Math.max(1, h - padding.top - padding.bottom);
  const span = max - min || 1;
  const stepX = plotWidth / Math.max(1, view.end - view.start - 1);

  /** @param {number} sample */
  const toX = (sample) => padding.left + (sample - view.start) * stepX;
  /** @param {number} v */
  const toY = (v) => padding.top + plotHeight - ((v - min) / span) * plotHeight;
  /** @param {number} sample */
  const inView = (sample) => sample >= view.start && sample < view.end;

  ctx.fillStyle = COLORS.selectionFill;
  ctx.strokeStyle = COLORS.selectionStroke;
  ctx.lineWidth = 1;
  for (const sel of options.selections ?? []) {
    const last = view.end - 1;
    const s = Math.max(view.start, Math.min(last, sel.start));
    const e = Math.max(s, Math.min(last, sel.end));
    const width = Math.max(1, toX(e) - toX(s));
    ctx.fillRect(toX(s), padding.top, width, plotHeight);
    ctx.strokeRect(toX(s), padding.top, width, plotHeight);
  }

  ctx.strokeStyle = COLORS.axis;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(padding.left, padding.top);
  ctx.lineTo(padding.left, padding.top + plotHeight);
  ctx.lineTo(padding.left + plotWidth, padding.top + plotHeight);
  ctx.stroke();

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
    ctx.fillText(`${value.toFixed(1)}`, padding.left - 8, y + 3);
  }
  ctx.textAlign = "left";

  const duration = (view.end - view.start) / fsamp;
  const targets = [0.1, 0.2, 0.5, 1, 2, 5, 10, 20];
  const desired = duration / 5;
  const step = targets.find((cand) => cand >= desired) ?? 20;
  const tStart = view.start / fsamp;
  const tEnd = view.end / fsamp;
  const first = Math.ceil(tStart / step) * step;
  ctx.fillStyle = COLORS.muted;
  for (let t = first; t <= tEnd; t += step) {
    const x = padding.left + ((t - tStart) / duration) * plotWidth;
    ctx.strokeStyle = COLORS.gridline;
    ctx.beginPath();
    ctx.moveTo(x, padding.top);
    ctx.lineTo(x, padding.top + plotHeight);
    ctx.stroke();
    ctx.fillText(`${t.toFixed(1)}s`, x - 10, padding.top + plotHeight + 12);
  }

  if (line) {
    ctx.strokeStyle = line.color;
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    for (let i = view.start; i < view.end; i++) {
      if (i === view.start) ctx.moveTo(toX(i), toY(line.values[i]));
      else ctx.lineTo(toX(i), toY(line.values[i]));
    }
    ctx.stroke();
  }

  for (const set of options.markers ?? []) {
    ctx.fillStyle = set.color;
    if (set.outlined) {
      ctx.strokeStyle = COLORS.markerOutline;
      ctx.lineWidth = 1;
    }
    set.positions.forEach((m, i) => {
      if (!inView(m)) return;
      ctx.beginPath();
      ctx.arc(toX(m), toY(set.values[i]), set.radius ?? 3, 0, Math.PI * 2);
      ctx.fill();
      if (set.outlined) ctx.stroke();
    });
  }

  return { ctx, top: padding.top, height: plotHeight, toX };
}
