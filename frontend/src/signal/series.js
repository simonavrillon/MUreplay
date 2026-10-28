/**
 * Viewport series, as MUedit2's plots draw them: a row is the samples of a
 * window, or their min/max per bin (an envelope). MUedit2's server bins the
 * window it sends; the replay holds the whole pulse train, so it bins here.
 */

/** @typedef {import("../app/context.js").Span} Span */
/** @typedef {{ min: Float32Array, max: Float32Array }} Envelope */
/** @typedef {Float32Array | Envelope} ChannelTrace */

/**
 * A window of a series: `row` holds the samples of `[start, end)`, or their
 * min/max per bin; null draws markers only.
 *
 * @typedef {object} TraceWindow
 * @property {ChannelTrace | null} row
 * @property {number} start
 * @property {number} end
 */

/**
 * @param {ChannelTrace | null | undefined} row
 * @returns {row is Float32Array}
 */
function isValues(row) {
  return row instanceof Float32Array;
}

/**
 * @param {ChannelTrace | null | undefined} row
 * @returns {row is Envelope}
 */
export function isEnvelope(row) {
  return !!row && !isValues(row);
}

/**
 * Points in a viewport row: its bins, or its samples (0 without a row).
 *
 * @param {ChannelTrace | null | undefined} row
 */
export function seriesPoints(row) {
  if (!row) return 0;
  return isEnvelope(row) ? row.min.length : row.length;
}

/**
 * Smallest and largest finite value over viewport rows.
 *
 * @param {(ChannelTrace | null | undefined)[]} rows
 */
function seriesRange(rows) {
  let min = Infinity;
  let max = -Infinity;
  for (const row of rows) {
    /** @type {ArrayLike<number>} */
    let lows;
    /** @type {ArrayLike<number>} */
    let highs;
    if (isEnvelope(row)) {
      lows = row.min;
      highs = row.max;
    } else if (isValues(row)) {
      lows = highs = row;
    } else {
      continue;
    }
    for (let i = 0; i < lows.length; i++) {
      if (lows[i] < min) min = lows[i];
    }
    for (let i = 0; i < highs.length; i++) {
      if (highs[i] > max) max = highs[i];
    }
  }
  return { min, max };
}

/**
 * Smallest and largest value of a trace window, `{0, 0}` when it has none.
 *
 * @param {TraceWindow | null | undefined} trace
 */
export function traceRange(trace) {
  const { min, max } = seriesRange(trace?.row ? [trace.row] : []);
  return Number.isFinite(min) && Number.isFinite(max)
    ? { min, max }
    : { min: 0, max: 0 };
}

/**
 * The samples of `series` in `view`, or their min/max in `bins` bins when
 * there are more samples than that, as MUedit2's server sends a window.
 *
 * @param {ArrayLike<number>} series
 * @param {Span} view
 * @param {number} bins The plot's width in pixels.
 * @returns {TraceWindow}
 */
export function traceWindow(series, view, bins) {
  const { start, end } = view;
  const n = end - start;
  if (n <= bins) {
    return {
      row: Float32Array.from({ length: n }, (_, i) => series[start + i]),
      start,
      end,
    };
  }
  const min = new Float32Array(bins);
  const max = new Float32Array(bins);
  for (let b = 0; b < bins; b++) {
    const first = start + Math.floor((b * n) / bins);
    const next = start + Math.floor(((b + 1) * n) / bins);
    let lo = series[first];
    let hi = lo;
    for (let i = first + 1; i < next; i++) {
      const v = series[i];
      if (v < lo) lo = v;
      else if (v > hi) hi = v;
    }
    min[b] = lo;
    max[b] = hi;
  }
  return { row: { min, max }, start, end };
}
