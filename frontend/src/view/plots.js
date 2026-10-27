/**
 * Canvas drawing primitives shared by all replay renderers.
 * Ported from the original charts.js drawSeries function.
 */

import { COLORS, canvasFont } from "../config.js";
import { extent } from "../io/utils.js";

/**
 * @typedef {object} DrawSeriesOptions
 * @property {string} [noDataText]
 * @property {boolean} [showAxes]
 * @property {boolean} [hideYAxis]
 * @property {number} [fsamp]
 * @property {string} [markerColor]
 */

/**
 * @param {HTMLCanvasElement | string | null} canvas
 * @param {number[]} series
 * @param {string} [color]
 * @param {number[]} [markers]
 * @param {any[]} [selections]
 * @param {number | null} [totalSamples]
 * @param {{ start?: number, end?: number } | null} [viewRange]
 * @param {number[] | null} [markerValues]
 * @param {boolean} [drawLine]
 * @param {DrawSeriesOptions} [options]
 */
export function drawSeries(
  canvas,
  series,
  color = COLORS.primary,
  markers = [],
  selections = [],
  totalSamples = null,
  viewRange = null,
  markerValues = null,
  drawLine = true,
  options = {},
) {
  const canvasEl =
    typeof canvas === "string"
      ? /** @type {HTMLCanvasElement | null} */ (
          document.getElementById(canvas)
        )
      : canvas;
  if (!canvasEl) return;
  const ctx = canvasEl.getContext("2d");
  if (!ctx) return;
  const w = canvasEl.clientWidth || canvasEl.width || 1;
  canvasEl.width = w;
  const h = canvasEl.clientHeight || canvasEl.height || 220;
  canvasEl.height = h;
  ctx.clearRect(0, 0, canvasEl.width, canvasEl.height);

  if (!series || !series.length) {
    const noDataText = options.noDataText ?? "No data";
    if (noDataText) {
      ctx.fillStyle = COLORS.muted;
      ctx.font = canvasFont();
      ctx.fillText(noDataText, 12, 24);
    }
    return;
  }

  const showAxes = !!options.showAxes;
  const hideYAxis = !!options.hideYAxis;
  const fsamp = options.fsamp || null;
  const markerColor = options.markerColor || COLORS.discharge;
  const padding = showAxes
    ? hideYAxis
      ? { left: 8, right: 8, top: 8, bottom: 20 }
      : { left: 38, right: 8, top: 8, bottom: 20 }
    : { left: 0, right: 0, top: 0, bottom: 0 };
  const plotWidth = Math.max(1, canvasEl.width - padding.left - padding.right);
  const plotHeight = Math.max(
    1,
    canvasEl.height - padding.top - padding.bottom,
  );

  const startIdx = viewRange?.start ?? 0;
  const endIdx = viewRange?.end ?? series.length;
  const clampedStart = Math.max(0, Math.min(series.length - 1, startIdx));
  const clampedEnd = Math.max(
    clampedStart + 1,
    Math.min(series.length, endIdx),
  );
  const sliced = series.slice(clampedStart, clampedEnd);
  const viewSpan = clampedEnd - clampedStart;

  const { min, max } = extent(sliced);
  const span = max - min || 1;
  const stepX = plotWidth / Math.max(1, sliced.length - 1);

  /** @param {number} idx */
  const toCanvasX = (idx) => padding.left + idx * stepX;
  /** @param {number} v */
  const toCanvasY = (v) =>
    padding.top + plotHeight - ((v - min) / span) * plotHeight;

  if (selections && selections.length && viewSpan > 0) {
    selections.forEach((sel) => {
      const rawStart = sel?.start ?? sel?.[0];
      const rawEnd = sel?.end ?? sel?.[1];
      if (!Number.isFinite(rawStart) || !Number.isFinite(rawEnd)) return;
      const s = Math.max(clampedStart, Math.min(clampedEnd, rawStart));
      const e = Math.max(s + 1, Math.min(clampedEnd, rawEnd));
      const startX = padding.left + ((s - clampedStart) / viewSpan) * plotWidth;
      const endX = padding.left + ((e - clampedStart) / viewSpan) * plotWidth;
      const width = Math.max(1, endX - startX);
      const hasY = Number.isFinite(sel?.yMin) && Number.isFinite(sel?.yMax);
      const yMin = hasY ? Math.max(0, Math.min(plotHeight, sel.yMin)) : 0;
      const yMax = hasY
        ? Math.max(0, Math.min(plotHeight, sel.yMax))
        : plotHeight;
      const rectTop = padding.top + Math.min(yMin, yMax);
      const rectHeight = Math.max(1, Math.abs(yMax - yMin));
      ctx.fillStyle = COLORS.selectionFill;
      ctx.fillRect(startX, rectTop, width, rectHeight);
      ctx.strokeStyle = COLORS.selectionStroke;
      ctx.lineWidth = 1;
      ctx.strokeRect(startX, rectTop, width, rectHeight);
    });
  }

  if (showAxes) {
    ctx.strokeStyle = COLORS.axis;
    ctx.lineWidth = 1;
    ctx.beginPath();
    if (!hideYAxis) {
      ctx.moveTo(padding.left, padding.top);
      ctx.lineTo(padding.left, padding.top + plotHeight);
    } else {
      ctx.moveTo(padding.left, padding.top + plotHeight);
    }
    ctx.lineTo(padding.left + plotWidth, padding.top + plotHeight);
    ctx.stroke();

    if (!hideYAxis) {
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
        ctx.fillText(`${value.toFixed(1)}`, padding.left - 8, y + 3);
      }
      ctx.textAlign = "left";
    }

    if (fsamp) {
      const duration = (clampedEnd - clampedStart) / fsamp;
      const targets = [0.1, 0.2, 0.5, 1, 2, 5, 10, 20];
      const desired = duration / 5;
      let step = targets[targets.length - 1];
      for (const cand of targets) {
        if (cand >= desired) {
          step = cand;
          break;
        }
      }
      const tStart = clampedStart / fsamp;
      const tEnd = clampedEnd / fsamp;
      const first = Math.ceil(tStart / step) * step;
      ctx.fillStyle = COLORS.muted;
      ctx.font = canvasFont();
      for (let t = first; t <= tEnd; t += step) {
        const frac = (t - tStart) / duration;
        const x = padding.left + frac * plotWidth;
        ctx.strokeStyle = COLORS.gridline;
        ctx.beginPath();
        ctx.moveTo(x, padding.top);
        ctx.lineTo(x, padding.top + plotHeight);
        ctx.stroke();
        ctx.fillText(`${t.toFixed(1)}s`, x - 10, padding.top + plotHeight + 12);
      }
    }
  }

  if (drawLine) {
    ctx.strokeStyle = color;
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    sliced.forEach((v, idx) => {
      const x = toCanvasX(idx);
      const y = toCanvasY(v);
      if (idx === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    ctx.stroke();
  }

  if (markers && markers.length) {
    markers.forEach((m, idx) => {
      if (m < clampedStart || m >= clampedEnd) return;
      const relIdx = m - clampedStart;
      const x = Math.min(
        padding.left + plotWidth,
        padding.left + (relIdx / Math.max(1, sliced.length - 1)) * plotWidth,
      );
      const val =
        markerValues && markerValues.length
          ? markerValues[idx]
          : sliced[relIdx];
      const y = toCanvasY(val);
      ctx.fillStyle = markerColor;
      ctx.beginPath();
      ctx.arc(x, y, 3, 0, Math.PI * 2);
      ctx.fill();
    });
  }

  if (selections && selections.length && totalSamples && !viewRange) {
    selections.forEach((sel) => {
      const startX = padding.left + (sel.start / totalSamples) * plotWidth;
      const endX = padding.left + (sel.end / totalSamples) * plotWidth;
      const hasY = Number.isFinite(sel?.yMin) && Number.isFinite(sel?.yMax);
      const yMin = hasY ? Math.max(0, Math.min(plotHeight, sel.yMin)) : 0;
      const yMax = hasY
        ? Math.max(0, Math.min(plotHeight, sel.yMax))
        : plotHeight;
      const rectTop = padding.top + Math.min(yMin, yMax);
      const rectHeight = Math.max(1, Math.abs(yMax - yMin));
      ctx.fillStyle = COLORS.selectionFill;
      ctx.fillRect(
        Math.min(startX, endX),
        rectTop,
        Math.abs(endX - startX),
        rectHeight,
      );
      ctx.strokeStyle = COLORS.selectionStroke;
      ctx.lineWidth = 1;
      ctx.strokeRect(
        Math.min(startX, endX),
        rectTop,
        Math.abs(endX - startX),
        rectHeight,
      );
    });
  }
}
