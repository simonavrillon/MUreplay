/**
 * Replay renderer: orchestrates pulse train, firing rate, and timeline canvases.
 * Ported from the original charts.js createCharts function.
 */

import { COLORS } from "../config.js";
import { drawSeries } from "./plots.js";
import { extent } from "../io/utils.js";

/**
 * @param {object} deps
 * @param {import("../app/dom.js").Els} deps.els
 * @param {import("../app/state.js").State} deps.state
 * @param {() => import("../app/state.js").EditLogEntry | null} deps.currentStep
 * @param {(step: import("../app/state.js").EditLogEntry | null) => boolean} deps.isCurrentMuStep
 * @param {() => number[]} deps.pulseForCurrentMu
 * @param {() => number[]} deps.distimesForCurrentMu
 * @param {() => number[]} deps.artifactTimesForCurrentMu
 */
export function createReplayRenderer(deps) {
  const { els, state } = deps;

  /**
   * @param {number} total
   */
  function getViewRange(total) {
    const view = state.replayView;
    if (!view || total <= 0) return null;
    const start = Math.max(0, Math.min(total - 1, Number(view.start) || 0));
    const end = Math.max(start + 1, Math.min(total, Number(view.end) || total));
    return { start, end };
  }

  function renderAll() {
    renderPulse();
    renderFiringRate();
    renderTimeline();
  }

  function renderPulse() {
    const pulse = deps.pulseForCurrentMu();
    const spikes = deps.distimesForCurrentMu();
    const viewRange = getViewRange(pulse.length);
    const step = deps.currentStep();
    const selections = [];
    if (
      step &&
      deps.isCurrentMuStep(step) &&
      step.viewStart != null &&
      step.viewEnd != null &&
      step.viewEnd > step.viewStart
    ) {
      selections.push({ start: step.viewStart, end: step.viewEnd });
    }
    const markerVals = spikes.map((s) => pulse?.[s] ?? 0);
    drawSeries(
      els.editPulseCanvas,
      pulse,
      COLORS.pulseTrain,
      spikes,
      selections,
      pulse.length,
      viewRange,
      markerVals,
      true,
      {
        showAxes: true,
        hideYAxis: false,
        fsamp: state.fsamp,
        markerColor: COLORS.discharge,
        noDataText: "No data",
      },
    );

    const regions = state.artifactRegions || [];
    if (regions.length && pulse && pulse.length > 0) {
      const canvasEl = els.editPulseCanvas;
      const ctx = canvasEl?.getContext("2d");
      if (ctx && canvasEl) {
        const w = canvasEl.width || canvasEl.clientWidth || 1;
        const h = canvasEl.height || canvasEl.clientHeight || 220;
        const padding = { left: 38, right: 8, top: 8, bottom: 20 };
        const plotWidth = Math.max(1, w - padding.left - padding.right);
        const total = pulse.length;
        const vStart = viewRange?.start ?? 0;
        const vEnd = viewRange?.end ?? total;
        const vSpan = Math.max(1, vEnd - vStart);
        ctx.fillStyle = COLORS.artifactWindowFill;
        ctx.strokeStyle = COLORS.artifactWindowStroke;
        ctx.lineWidth = 1;
        regions.forEach(([rs, re]) => {
          if (re <= vStart || rs >= vEnd) return;
          const x1 =
            padding.left +
            ((Math.max(rs, vStart) - vStart) / Math.max(1, vSpan - 1)) *
              plotWidth;
          const x2 =
            padding.left +
            ((Math.min(re, vEnd) - vStart) / Math.max(1, vSpan - 1)) *
              plotWidth;
          const spanPx = Math.max(2, x2 - x1);
          ctx.fillRect(
            x1,
            padding.top,
            spanPx,
            h - padding.top - padding.bottom,
          );
          ctx.strokeRect(
            x1 + 0.5,
            padding.top + 0.5,
            spanPx - 1,
            h - padding.top - padding.bottom - 1,
          );
        });
      }
    }

    if (step && pulse && pulse.length > 0) {
      const added =
        deps.isCurrentMuStep(step) && Array.isArray(step.spikesAdded)
          ? step.spikesAdded
          : [];
      const removed =
        deps.isCurrentMuStep(step) && Array.isArray(step.spikesRemoved)
          ? step.spikesRemoved
          : [];
      if (added.length || removed.length) {
        const canvasEl = els.editPulseCanvas;
        const ctx = canvasEl?.getContext("2d");
        if (!ctx || !canvasEl) return;
        const w = canvasEl.width || canvasEl.clientWidth || 1;
        const h = canvasEl.height || canvasEl.clientHeight || 220;
        const padding = { left: 38, right: 8, top: 8, bottom: 20 };
        const plotWidth = Math.max(1, w - padding.left - padding.right);
        const total = pulse.length;
        const vStart = viewRange?.start ?? 0;
        const vEnd = viewRange?.end ?? total;
        const vSpan = Math.max(1, vEnd - vStart);
        /**
         * @param {number[]} spikeList
         * @param {string} fillColor
         * @param {string} strokeColor
         */
        const drawSpikeROI = (spikeList, fillColor, strokeColor) => {
          spikeList.forEach((s) => {
            if (s < 0 || s >= total || s < vStart || s >= vEnd) return;
            const x =
              padding.left +
              ((s - vStart) / Math.max(1, vSpan - 1)) * plotWidth;
            ctx.fillStyle = fillColor;
            ctx.fillRect(
              x - 2,
              padding.top,
              4,
              h - padding.top - padding.bottom,
            );
            ctx.strokeStyle = strokeColor;
            ctx.lineWidth = 1;
            ctx.beginPath();
            ctx.moveTo(x, padding.top);
            ctx.lineTo(x, h - padding.bottom);
            ctx.stroke();
          });
        };
        drawSpikeROI(removed, COLORS.stepRemovedFill, COLORS.stepRemovedStroke);
        drawSpikeROI(added, COLORS.stepAddedFill, COLORS.stepAddedStroke);
      }
    }

    const artifacts = deps.artifactTimesForCurrentMu();
    if (artifacts.length && pulse && pulse.length > 0) {
      const canvasEl = els.editPulseCanvas;
      const ctx = canvasEl?.getContext("2d");
      if (!ctx || !canvasEl) return;
      const padding = { left: 38, right: 8, top: 8, bottom: 20 };
      const plotWidth = Math.max(
        1,
        (canvasEl.width || canvasEl.clientWidth || 1) -
          padding.left -
          padding.right,
      );
      const plotHeight = Math.max(
        1,
        (canvasEl.height || canvasEl.clientHeight || 220) -
          padding.top -
          padding.bottom,
      );
      const total = pulse.length;
      const vStart = viewRange?.start ?? 0;
      const vEnd = viewRange?.end ?? total;
      const vSpan = Math.max(1, vEnd - vStart);
      const { min: pMin, max: pMax } = extent(pulse, vStart, vEnd);
      const pSpan = pMax - pMin || 1;
      ctx.fillStyle = COLORS.artifactMarker;
      artifacts.forEach((s) => {
        if (s < vStart || s >= vEnd) return;
        const x =
          padding.left + ((s - vStart) / Math.max(1, vSpan - 1)) * plotWidth;
        const val = pulse[s] ?? 0;
        const y =
          padding.top + plotHeight - ((val - pMin) / pSpan) * plotHeight;
        ctx.beginPath();
        ctx.arc(x, y, 4, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = COLORS.markerOutline;
        ctx.lineWidth = 1;
        ctx.stroke();
      });
    }
  }

  function renderFiringRate() {
    const spikes = deps.distimesForCurrentMu();
    const pulse = deps.pulseForCurrentMu();
    const total = pulse.length || (spikes.length ? extent(spikes).max + 1 : 0);
    const viewRange = getViewRange(total);
    if (!total) {
      drawSeries(
        els.editDrCanvas,
        [],
        COLORS.warning,
        [],
        [],
        0,
        null,
        null,
        false,
        {
          showAxes: true,
          hideYAxis: false,
          fsamp: state.fsamp,
          markerColor: COLORS.discharge,
          noDataText: "No data",
        },
      );
      return;
    }

    const series = new Array(total).fill(0);
    const markers = [];
    const markerVals = [];
    for (let i = 0; i < spikes.length - 1; i += 1) {
      const isi = spikes[i + 1] - spikes[i];
      if (isi <= 0) continue;
      const mid = Math.round(spikes[i] + isi / 2);
      const dr = state.fsamp / isi;
      if (mid >= 0 && mid < total) {
        series[mid] = dr;
        markers.push(mid);
        markerVals.push(dr);
      }
    }

    const step = deps.currentStep();
    const selections = [];
    if (
      step &&
      deps.isCurrentMuStep(step) &&
      step.viewStart != null &&
      step.viewEnd != null &&
      step.viewEnd > step.viewStart
    ) {
      selections.push({ start: step.viewStart, end: step.viewEnd });
    }
    drawSeries(
      els.editDrCanvas,
      series,
      COLORS.warning,
      markers,
      selections,
      total,
      viewRange,
      markerVals,
      false,
      {
        showAxes: true,
        hideYAxis: false,
        fsamp: state.fsamp,
        markerColor: COLORS.discharge,
        noDataText: "No data",
      },
    );
  }

  const TIMELINE_PAD_L = 38;
  const TIMELINE_PAD_R = 8;

  /**
   * @param {number} total
   */
  function timelineView(total) {
    return state.replayView && state.replayView.end > state.replayView.start
      ? state.replayView
      : { start: 0, end: total };
  }

  function renderTimeline() {
    const canvas = els.editTimelineCanvas;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const w = canvas.clientWidth || canvas.width || 1;
    canvas.width = w;
    canvas.height = 20;
    ctx.clearRect(0, 0, w, 20);

    const pulse = deps.pulseForCurrentMu();
    const total = pulse?.length || 0;
    if (!total) return;

    const bw = Math.max(1, w - TIMELINE_PAD_L - TIMELINE_PAD_R);
    const barTop = 4;
    const barH = 12;

    ctx.fillStyle = COLORS.timelineTrack;
    ctx.fillRect(TIMELINE_PAD_L, barTop, bw, barH);

    const step = deps.currentStep();
    if (step && deps.isCurrentMuStep(step)) {
      const added = Array.isArray(step.spikesAdded) ? step.spikesAdded : [];
      const removed = Array.isArray(step.spikesRemoved)
        ? step.spikesRemoved
        : [];
      ctx.fillStyle = COLORS.timelineAdded;
      added.forEach((s) => {
        if (s >= 0 && s < total)
          ctx.fillRect(
            TIMELINE_PAD_L + Math.round((s / total) * bw),
            barTop,
            2,
            barH,
          );
      });
      ctx.fillStyle = COLORS.timelineRemoved;
      removed.forEach((s) => {
        if (s >= 0 && s < total)
          ctx.fillRect(
            TIMELINE_PAD_L + Math.round((s / total) * bw),
            barTop,
            2,
            barH,
          );
      });
    }

    const spikes = deps.distimesForCurrentMu();
    ctx.fillStyle = COLORS.timelineSpikes;
    spikes.forEach((s) => {
      if (s >= 0 && s < total)
        ctx.fillRect(
          TIMELINE_PAD_L + Math.round((s / total) * bw),
          barTop,
          2,
          barH,
        );
    });

    const view = timelineView(total);
    const x1 = TIMELINE_PAD_L + (Math.max(0, view.start) / total) * bw;
    const x2 = TIMELINE_PAD_L + (Math.min(total, view.end) / total) * bw;
    const ww = Math.max(4, x2 - x1);
    ctx.fillStyle = COLORS.timelineViewFill;
    ctx.fillRect(x1, barTop - 2, ww, barH + 4);
    ctx.strokeStyle = COLORS.timelineViewStroke;
    ctx.lineWidth = 1;
    ctx.strokeRect(x1 + 0.5, barTop - 1.5, Math.max(3, ww - 1), barH + 3);
  }

  function bindTimeline() {
    const canvas = els.editTimelineCanvas;
    if (!canvas) return;

    let dragging = false;
    let startClientX = 0;
    let dragViewStart = 0;
    let didMove = false;

    const getTotal = () => deps.pulseForCurrentMu().length;

    /**
     * @param {number} s
     * @param {number} e2
     * @param {number} total
     */
    const applyView = (s, e2, total) => {
      if (s < 0) {
        e2 -= s;
        s = 0;
      }
      if (e2 > total) {
        s = Math.max(0, s - (e2 - total));
        e2 = total;
      }
      if (e2 <= s) e2 = Math.min(total, s + 1);
      state.replayView = { start: s, end: e2 };
      renderAll();
    };

    canvas.addEventListener("mousedown", (e) => {
      const total = getTotal();
      if (!total) return;
      dragging = true;
      didMove = false;
      startClientX = e.clientX;
      dragViewStart = timelineView(total).start;
    });

    window.addEventListener("mousemove", (e) => {
      if (!dragging) return;
      if (Math.abs(e.clientX - startClientX) > 3) didMove = true;
      if (!didMove) return;
      const total = getTotal();
      if (!total) return;
      const rect = canvas.getBoundingClientRect();
      const bw = Math.max(1, rect.width - TIMELINE_PAD_L - TIMELINE_PAD_R);
      const delta = Math.round(((e.clientX - startClientX) / bw) * total);
      const view = timelineView(total);
      const span = view.end - view.start;
      applyView(dragViewStart + delta, dragViewStart + delta + span, total);
    });

    window.addEventListener("mouseup", (e) => {
      if (!dragging) return;
      dragging = false;
      if (didMove) return;
      const total = getTotal();
      if (!total) return;
      const view = timelineView(total);
      const span = view.end - view.start;
      const rect = canvas.getBoundingClientRect();
      const bw = Math.max(1, rect.width - TIMELINE_PAD_L - TIMELINE_PAD_R);
      const frac = Math.max(
        0,
        Math.min(1, (e.clientX - rect.left - TIMELINE_PAD_L) / bw),
      );
      const s = Math.round(frac * total - span / 2);
      applyView(s, s + span, total);
    });
  }

  return { renderAll, bindTimeline };
}
