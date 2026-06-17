export function createCharts({ els, state, COLORS, UNIFORM_PULSE_COLOR, currentStep, isCurrentMuStep, pulseForCurrentMu, distimesForCurrentMu, artifactTimesForCurrentMu }) {
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
  }

  function drawSeries(
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
    const canvasEl = typeof canvas === "string" ? document.getElementById(canvas) : canvas;
    if (!canvasEl) return;
    const ctx = canvasEl.getContext("2d");
    const w = canvasEl.clientWidth || canvasEl.width || 1;
    canvasEl.width = w;
    const h = canvasEl.clientHeight || canvasEl.height || 220;
    canvasEl.height = h;
    ctx.clearRect(0, 0, canvasEl.width, canvasEl.height);

    if (!series || !series.length) {
      const noDataText = options.noDataText ?? "No data";
      if (noDataText) {
        ctx.fillStyle = COLORS.muted;
        ctx.font = "12px sans-serif";
        ctx.fillText(noDataText, 12, 24);
      }
      return;
    }

    const showAxes = !!options.showAxes;
    const hideYAxis = !!options.hideYAxis;
    const fsamp = options.fsamp || null;
    const markerColor = options.markerColor || "#e7c1ff";
    const padding = showAxes
      ? hideYAxis
        ? { left: 8, right: 8, top: 8, bottom: 20 }
        : { left: 38, right: 8, top: 8, bottom: 20 }
      : { left: 0, right: 0, top: 0, bottom: 0 };
    const plotWidth = Math.max(1, canvasEl.width - padding.left - padding.right);
    const plotHeight = Math.max(1, canvasEl.height - padding.top - padding.bottom);

    const startIdx = viewRange?.start ?? 0;
    const endIdx = viewRange?.end ?? series.length;
    const clampedStart = Math.max(0, Math.min(series.length - 1, startIdx));
    const clampedEnd = Math.max(clampedStart + 1, Math.min(series.length, endIdx));
    const sliced = series.slice(clampedStart, clampedEnd);
    const viewSpan = clampedEnd - clampedStart;

    const max = Math.max(...sliced);
    const min = Math.min(...sliced);
    const span = max - min || 1;
    const stepX = plotWidth / Math.max(1, sliced.length - 1);

    const toCanvasX = (idx) => padding.left + idx * stepX;
    const toCanvasY = (v) => padding.top + plotHeight - ((v - min) / span) * plotHeight;

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
        const yMax = hasY ? Math.max(0, Math.min(plotHeight, sel.yMax)) : plotHeight;
        const rectTop = padding.top + Math.min(yMin, yMax);
        const rectHeight = Math.max(1, Math.abs(yMax - yMin));
        ctx.fillStyle = "rgba(195, 155, 242, 0.08)";
        ctx.fillRect(startX, rectTop, width, rectHeight);
        ctx.strokeStyle = "rgba(195, 155, 242, 0.6)";
        ctx.lineWidth = 1;
        ctx.strokeRect(startX, rectTop, width, rectHeight);
      });
    }

    if (showAxes) {
      ctx.strokeStyle = "rgba(255, 255, 255, 0.15)";
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
        const yTicks = 3;
        for (let i = 0; i <= yTicks; i++) {
          const t = i / yTicks;
          const y = padding.top + plotHeight - t * plotHeight;
          ctx.strokeStyle = "rgba(255, 255, 255, 0.08)";
          ctx.beginPath();
          ctx.moveTo(padding.left, y);
          ctx.lineTo(padding.left + plotWidth, y);
          ctx.stroke();
        }
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
        ctx.font = "10px sans-serif";
        for (let t = first; t <= tEnd; t += step) {
          const frac = (t - tStart) / duration;
          const x = padding.left + frac * plotWidth;
          ctx.strokeStyle = "rgba(255, 255, 255, 0.08)";
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
        const val = markerValues && markerValues.length ? markerValues[idx] : sliced[relIdx];
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
        const yMax = hasY ? Math.max(0, Math.min(plotHeight, sel.yMax)) : plotHeight;
        const rectTop = padding.top + Math.min(yMin, yMax);
        const rectHeight = Math.max(1, Math.abs(yMax - yMin));
        ctx.fillStyle = "rgba(195, 155, 242, 0.08)";
        ctx.fillRect(Math.min(startX, endX), rectTop, Math.abs(endX - startX), rectHeight);
        ctx.strokeStyle = "rgba(195, 155, 242, 0.6)";
        ctx.lineWidth = 1;
        ctx.strokeRect(Math.min(startX, endX), rectTop, Math.abs(endX - startX), rectHeight);
      });
    }
  }

  function renderPulse() {
    const pulse = pulseForCurrentMu();
    const spikes = distimesForCurrentMu();
    const viewRange = getViewRange(pulse.length);
    const step = currentStep();
    const selections = [];
    if (
      isCurrentMuStep(step)
      && Number.isFinite(step?.viewStart)
      && Number.isFinite(step?.viewEnd)
      && step.viewEnd > step.viewStart
    ) {
      selections.push({ start: step.viewStart, end: step.viewEnd });
    }
    const markerVals = spikes.map((s) => pulse?.[s] ?? 0);
    drawSeries(
      els.editPulseCanvas,
      pulse,
      UNIFORM_PULSE_COLOR,
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
        markerColor: "#e7c1ff",
        noDataText: "No data",
      },
    );

    if (step && pulse && pulse.length > 0) {
      const added = isCurrentMuStep(step) && Array.isArray(step.spikesAdded) ? step.spikesAdded : [];
      const removed = isCurrentMuStep(step) && Array.isArray(step.spikesRemoved) ? step.spikesRemoved : [];
      if (added.length || removed.length) {
        const canvasEl = els.editPulseCanvas;
        const ctx = canvasEl.getContext("2d");
        const w = canvasEl.width || canvasEl.clientWidth || 1;
        const h = canvasEl.height || canvasEl.clientHeight || 220;
        const padding = { left: 38, right: 8, top: 8, bottom: 20 };
        const plotWidth = Math.max(1, w - padding.left - padding.right);
        const total = pulse.length;
        const vStart = viewRange?.start ?? 0;
        const vEnd = viewRange?.end ?? total;
        const vSpan = Math.max(1, vEnd - vStart);
        const drawSpikeROI = (spikeList, fillColor, strokeColor) => {
          spikeList.forEach((s) => {
            if (s < 0 || s >= total || s < vStart || s >= vEnd) return;
            const x = padding.left + ((s - vStart) / Math.max(1, vSpan - 1)) * plotWidth;
            ctx.fillStyle = fillColor;
            ctx.fillRect(x - 2, padding.top, 4, h - padding.top - padding.bottom);
            ctx.strokeStyle = strokeColor;
            ctx.lineWidth = 1;
            ctx.beginPath();
            ctx.moveTo(x, padding.top);
            ctx.lineTo(x, h - padding.bottom);
            ctx.stroke();
          });
        };
        drawSpikeROI(removed, "rgba(255, 80, 80, 0.18)", "rgba(255, 80, 80, 0.75)");
        drawSpikeROI(added, "rgba(80, 220, 120, 0.18)", "rgba(80, 220, 120, 0.75)");
      }
    }

    const artifacts = typeof artifactTimesForCurrentMu === "function" ? artifactTimesForCurrentMu() : [];
    if (artifacts.length && pulse && pulse.length > 0) {
      const canvasEl = els.editPulseCanvas;
      const ctx = canvasEl.getContext("2d");
      const padding = { left: 38, right: 8, top: 8, bottom: 20 };
      const plotWidth = Math.max(1, (canvasEl.width || canvasEl.clientWidth || 1) - padding.left - padding.right);
      const plotHeight = Math.max(1, (canvasEl.height || canvasEl.clientHeight || 220) - padding.top - padding.bottom);
      const total = pulse.length;
      const vStart = viewRange?.start ?? 0;
      const vEnd = viewRange?.end ?? total;
      const vSpan = Math.max(1, vEnd - vStart);
      const pMax = Math.max(...pulse.slice(vStart, vEnd));
      const pMin = Math.min(...pulse.slice(vStart, vEnd));
      const pSpan = pMax - pMin || 1;
      ctx.fillStyle = COLORS.artifact || "#ff8c66";
      artifacts.forEach((s) => {
        if (s < vStart || s >= vEnd) return;
        const x = padding.left + ((s - vStart) / Math.max(1, vSpan - 1)) * plotWidth;
        const val = pulse[s] ?? 0;
        const y = padding.top + plotHeight - ((val - pMin) / pSpan) * plotHeight;
        ctx.beginPath();
        ctx.arc(x, y, 4, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = "rgba(0,0,0,0.4)";
        ctx.lineWidth = 1;
        ctx.stroke();
      });
    }
  }

  function renderFiringRate() {
    const spikes = distimesForCurrentMu();
    const pulse = pulseForCurrentMu();
    const total = pulse.length || (spikes.length ? Math.max(...spikes) + 1 : 0);
    const viewRange = getViewRange(total);
    if (!total) {
      drawSeries(els.editDrCanvas, [], COLORS.warning, [], [], 0, null, null, false, {
        showAxes: true,
        hideYAxis: false,
        fsamp: state.fsamp,
        markerColor: "#e7c1ff",
        noDataText: "No data",
      });
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

    const step = currentStep();
    const selections = [];
    if (
      isCurrentMuStep(step)
      && Number.isFinite(step?.viewStart)
      && Number.isFinite(step?.viewEnd)
      && step.viewEnd > step.viewStart
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
        markerColor: "#e7c1ff",
        noDataText: "No data",
      },
    );
  }

  return {
    renderAll,
  };
}
