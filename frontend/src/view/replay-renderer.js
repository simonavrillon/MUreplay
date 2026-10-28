/**
 * Replay renderer: draws the current MU's discharge rates, pulse train and
 * timeline from the state it is given, as MUedit2's edit page draws them,
 * with the step in view and the artifact windows over the pulse train.
 */

import { COLORS } from "../config.js";
import {
  artifactsForCurrentMu,
  clampedReplayView,
  currentMuStep,
  pulseTrainForCurrentMu,
  spikesForCurrentMu,
} from "../state/selectors.js";
import { traceWindow } from "../signal/series.js";
import {
  PLOT_PADDING,
  drawTrace,
  getCanvasPlotMetrics,
  prepareCanvas,
  viewScale,
} from "./plots.js";

/** @typedef {import("../app/context.js").Span} Span */
/** @typedef {import("../state/state.js").EditLogEntry} EditLogEntry */
/** @typedef {import("./plots.js").Selection} Selection */

const TIMELINE_BAR_TOP = 4;
const TIMELINE_BAR_H = 12;

/**
 * The width of the timeline bar, inset like the plots so it lines up with their axis.
 *
 * @param {number} canvasWidth
 */
export function timelineBarWidth(canvasWidth) {
  return Math.max(1, canvasWidth - PLOT_PADDING.left - PLOT_PADDING.right);
}

/**
 * The instantaneous discharge rate between each pair of discharges, placed at
 * their midpoint, as MUedit2 computes it.
 *
 * @param {number[]} spikes
 * @param {number} fsamp
 * @param {number} totalSamples
 */
function dischargeRates(spikes, fsamp, totalSamples) {
  /** @type {number[]} */
  const positions = [];
  /** @type {number[]} */
  const rates = [];
  for (let i = 0; i < spikes.length - 1; i++) {
    const isi = spikes[i + 1] - spikes[i];
    if (isi <= 0) continue;
    const at = Math.round(spikes[i] + isi / 2);
    positions.push(Math.min(totalSamples - 1, Math.max(0, at)));
    rates.push(fsamp ? fsamp / isi : 0);
  }
  return { positions, rates };
}

/**
 * The fastest rate whose midpoint is in `view`: the top of the rate plot.
 *
 * @param {ReturnType<typeof dischargeRates>} rates
 * @param {Span} view
 */
function fastestRateInView({ positions, rates }, view) {
  let fastest = 0;
  for (let i = 0; i < positions.length; i++) {
    if (positions[i] >= view.start && positions[i] < view.end) {
      fastest = Math.max(fastest, rates[i]);
    }
  }
  return fastest;
}

/**
 * The window the step behind the playhead covers, highlighted over the whole
 * plot height.
 *
 * @param {EditLogEntry | null} step
 * @returns {Selection[]}
 */
function stepSelections(step) {
  if (step?.viewStart == null || step.viewEnd == null) return [];
  if (step.viewEnd <= step.viewStart) return [];
  return [
    { start: step.viewStart, end: step.viewEnd, yMin: 0, yMax: Infinity },
  ];
}

/**
 * Fill a 2 px tick at each sample in `positions`, once per pixel column.
 *
 * @param {CanvasRenderingContext2D} ctx
 * @param {number[]} positions
 * @param {number} totalSamples
 * @param {number} barWidth
 */
function fillTicks(ctx, positions, totalSamples, barWidth) {
  const drawn = new Set();
  for (const s of positions) {
    if (s < 0 || s >= totalSamples) continue;
    const x = PLOT_PADDING.left + Math.round((s / totalSamples) * barWidth);
    if (drawn.has(x)) continue;
    drawn.add(x);
    ctx.fillRect(x, TIMELINE_BAR_TOP, 2, TIMELINE_BAR_H);
  }
}

/**
 * @param {{ els: import("../app/dom.js").Els, state: import("../state/state.js").State }} deps
 */
export function createReplayRenderer({ els, state }) {
  function renderAll() {
    renderPulseTrain();
    renderDischargeRates();
    renderTimeline();
  }

  function renderPulseTrain() {
    const canvas = els.editPulseCanvas;
    const pulseTrain = pulseTrainForCurrentMu(state);
    const view = clampedReplayView(state, pulseTrain.length);
    if (!pulseTrain.length) {
      drawTrace(canvas, null, view);
      return;
    }
    const spikes = spikesForCurrentMu(state);
    const artifacts = artifactsForCurrentMu(state);
    const step = currentMuStep(state);
    const { plotWidth } = getCanvasPlotMetrics(canvas);
    drawTrace(
      canvas,
      traceWindow(pulseTrain, view, Math.max(1, Math.round(plotWidth))),
      view,
      {
        color: COLORS.pulseTrain,
        selections: stepSelections(step),
        fsamp: state.fsamp,
        markers: [
          {
            positions: spikes,
            values: spikes.map((s) => pulseTrain[s] ?? 0),
            color: COLORS.discharge,
          },
          {
            positions: artifacts,
            values: artifacts.map((s) => pulseTrain[s] ?? 0),
            color: COLORS.artifactMarker,
            radius: 4,
            outlined: true,
          },
        ],
      },
    );

    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const { padding, plotHeight } = getCanvasPlotMetrics(canvas);
    const { toX } = viewScale(view, padding.left, plotWidth);
    const top = padding.top;

    ctx.fillStyle = COLORS.artifactWindowFill;
    ctx.strokeStyle = COLORS.artifactWindowStroke;
    ctx.lineWidth = 1;
    for (const [rs, re] of state.artifactRegions) {
      if (re <= view.start || rs >= view.end) continue;
      const x1 = toX(Math.max(rs, view.start));
      const spanPx = Math.max(2, toX(Math.min(re, view.end)) - x1);
      ctx.fillRect(x1, top, spanPx, plotHeight);
      ctx.strokeRect(x1 + 0.5, top + 0.5, spanPx - 1, plotHeight - 1);
    }

    if (!step) return;
    /**
     * @param {number[]} positions
     * @param {string} fill
     * @param {string} stroke
     */
    const drawStepBands = (positions, fill, stroke) => {
      ctx.fillStyle = fill;
      ctx.strokeStyle = stroke;
      ctx.lineWidth = 1;
      for (const s of positions) {
        if (s < view.start || s >= view.end) continue;
        const x = toX(s);
        ctx.fillRect(x - 2, top, 4, plotHeight);
        ctx.beginPath();
        ctx.moveTo(x, top);
        ctx.lineTo(x, top + plotHeight);
        ctx.stroke();
      }
    };
    drawStepBands(
      step.spikesRemoved,
      COLORS.stepRemovedFill,
      COLORS.stepRemovedStroke,
    );
    drawStepBands(
      step.spikesAdded,
      COLORS.stepAddedFill,
      COLORS.stepAddedStroke,
    );
  }

  function renderDischargeRates() {
    const canvas = els.editDrCanvas;
    const spikes = spikesForCurrentMu(state);
    const totalSamples = pulseTrainForCurrentMu(state).length;
    if (!totalSamples || !spikes.length) {
      drawTrace(canvas, null, { start: 0, end: 0 });
      return;
    }
    const view = clampedReplayView(state, totalSamples);
    const rates = dischargeRates(spikes, state.fsamp, totalSamples);
    drawTrace(canvas, { row: null, start: view.start, end: view.end }, view, {
      range: { min: 0, max: fastestRateInView(rates, view) },
      selections: stepSelections(currentMuStep(state)),
      fsamp: state.fsamp,
      markers: [
        {
          positions: rates.positions,
          values: rates.rates,
          color: COLORS.discharge,
        },
      ],
    });
  }

  function renderTimeline() {
    const prepared = prepareCanvas(els.editTimelineCanvas, { height: 20 });
    if (!prepared) return;
    const { ctx, width } = prepared;

    const totalSamples = pulseTrainForCurrentMu(state).length;
    if (!totalSamples) return;

    const barWidth = timelineBarWidth(width);

    ctx.fillStyle = COLORS.timelineTrack;
    ctx.fillRect(PLOT_PADDING.left, TIMELINE_BAR_TOP, barWidth, TIMELINE_BAR_H);

    // The current step: what it added, and what it removed.
    const step = currentMuStep(state);
    if (step) {
      ctx.fillStyle = COLORS.timelineAdded;
      fillTicks(
        ctx,
        [...step.spikesAdded, ...step.artifactsAdded],
        totalSamples,
        barWidth,
      );
      ctx.fillStyle = COLORS.timelineRemoved;
      fillTicks(
        ctx,
        [...step.spikesRemoved, ...step.artifactsRemoved],
        totalSamples,
        barWidth,
      );
    }

    // The current discharges, over the step.
    ctx.fillStyle = COLORS.timelineSpikes;
    fillTicks(ctx, spikesForCurrentMu(state), totalSamples, barWidth);

    const view = clampedReplayView(state, totalSamples);
    const x1 = PLOT_PADDING.left + (view.start / totalSamples) * barWidth;
    const x2 = PLOT_PADDING.left + (view.end / totalSamples) * barWidth;
    const viewWidth = Math.max(4, x2 - x1);
    ctx.fillStyle = COLORS.timelineViewFill;
    ctx.fillRect(x1, TIMELINE_BAR_TOP - 2, viewWidth, TIMELINE_BAR_H + 4);
    ctx.strokeStyle = COLORS.timelineViewStroke;
    ctx.lineWidth = 1;
    ctx.strokeRect(
      x1 + 0.5,
      TIMELINE_BAR_TOP - 1.5,
      Math.max(3, viewWidth - 1),
      TIMELINE_BAR_H + 3,
    );
  }

  return { renderAll };
}
