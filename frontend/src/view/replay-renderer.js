/**
 * Replay renderer: draws the current MU's discharge rates, pulse train and
 * timeline from the state it is given.
 */

import { COLORS } from "../config.js";
import {
  artifactsForCurrentMu,
  clampedReplayView,
  currentMuStep,
  pulseTrainForCurrentMu,
  spikesForCurrentMu,
} from "../state/selectors.js";
import { seriesRange } from "../signal/series.js";
import { PLOT_PADDING, drawSeries } from "./plots.js";

/** @typedef {import("../app/context.js").Span} Span */
/** @typedef {import("../state/state.js").EditLogEntry} EditLogEntry */

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
 * their midpoint.
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
    if (at < 0 || at >= totalSamples) continue;
    positions.push(at);
    rates.push(fsamp / isi);
  }
  return { positions, rates };
}

/**
 * The window the step behind the playhead covers, as the plots highlight it.
 *
 * @param {EditLogEntry | null} step
 * @returns {Span[]}
 */
function stepSelections(step) {
  if (step?.viewStart == null || step.viewEnd == null) return [];
  if (step.viewEnd <= step.viewStart) return [];
  return [{ start: step.viewStart, end: step.viewEnd }];
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
    const pulseTrain = pulseTrainForCurrentMu(state);
    const spikes = spikesForCurrentMu(state);
    const artifacts = artifactsForCurrentMu(state);
    const view = clampedReplayView(state, pulseTrain.length);
    const step = currentMuStep(state);
    const plot = drawSeries(els.pulseTrainCanvas, view, {
      line: { values: pulseTrain, color: COLORS.pulseTrain },
      range: seriesRange(pulseTrain, view.start, view.end),
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
    });
    if (!plot) return;
    const { ctx, top, height, toX } = plot;

    ctx.fillStyle = COLORS.artifactWindowFill;
    ctx.strokeStyle = COLORS.artifactWindowStroke;
    ctx.lineWidth = 1;
    for (const [rs, re] of state.artifactRegions) {
      if (re <= view.start || rs >= view.end) continue;
      const x1 = toX(Math.max(rs, view.start));
      const spanPx = Math.max(2, toX(Math.min(re, view.end)) - x1);
      ctx.fillRect(x1, top, spanPx, height);
      ctx.strokeRect(x1 + 0.5, top + 0.5, spanPx - 1, height - 1);
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
        ctx.fillRect(x - 2, top, 4, height);
        ctx.beginPath();
        ctx.moveTo(x, top);
        ctx.lineTo(x, top + height);
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
    const spikes = spikesForCurrentMu(state);
    const totalSamples = pulseTrainForCurrentMu(state).length;
    const view = clampedReplayView(state, totalSamples);
    const { positions, rates } = dischargeRates(
      spikes,
      state.fsamp,
      totalSamples,
    );
    const fastest = rates.reduce(
      (fastestSoFar, rate, i) =>
        positions[i] >= view.start && positions[i] < view.end
          ? Math.max(fastestSoFar, rate)
          : fastestSoFar,
      0,
    );
    drawSeries(els.dischargeRateCanvas, view, {
      range: { min: 0, max: fastest },
      selections: stepSelections(currentMuStep(state)),
      fsamp: state.fsamp,
      markers: [{ positions, values: rates, color: COLORS.discharge }],
    });
  }

  function renderTimeline() {
    const canvas = els.timelineCanvas;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const w = canvas.clientWidth || canvas.width || 1;
    canvas.width = w;
    canvas.height = 20;
    ctx.clearRect(0, 0, w, 20);

    const totalSamples = pulseTrainForCurrentMu(state).length;
    if (!totalSamples) return;

    const barWidth = timelineBarWidth(w);

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
