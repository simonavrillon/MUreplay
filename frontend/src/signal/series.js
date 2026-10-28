/**
 * Sample series: the range of values a plot scales to.
 */

/**
 * Smallest and largest value in `series[start..end)`, a non-empty range within `series`.
 *
 * `Math.max(...series)` passes every element as an argument and throws
 * `RangeError: Maximum call stack size exceeded` past roughly 125k of them, so
 * it cannot be used on a pulse train: at 2048 Hz that ceiling is a recording
 * just over a minute long, and the charts scale to the full signal by default.
 *
 * @param {number[]} series
 * @param {number} [start]
 * @param {number} [end]
 * @returns {{ min: number, max: number }}
 */
export function seriesRange(series, start = 0, end = series.length) {
  let min = series[start];
  let max = series[start];
  for (let i = start + 1; i < end; i += 1) {
    const v = series[i];
    if (v < min) min = v;
    else if (v > max) max = v;
  }
  return { min, max };
}
