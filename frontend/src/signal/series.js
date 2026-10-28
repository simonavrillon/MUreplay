/**
 * Sample series: the range of values a plot scales to.
 */

/**
 * Smallest and largest value in `values[start..end)`.
 *
 * `Math.max(...values)` passes every element as an argument and throws
 * `RangeError: Maximum call stack size exceeded` past roughly 125k of them, so
 * it cannot be used on a pulse train: at 2048 Hz that ceiling is a recording
 * just over a minute long, and the charts scale to the full signal by default.
 * Taking a range instead of a pre-sliced array also avoids copying the samples
 * just to measure them.
 *
 * An empty range has no extent; it reports `{ min: 0, max: 0 }` so callers
 * scale against a flat zero line rather than `Infinity`.
 *
 * @param {number[]} values
 * @param {number} [start]
 * @param {number} [end]
 * @returns {{ min: number, max: number }}
 */
export function extent(values, start = 0, end = values.length) {
  const from = Math.max(0, start);
  const to = Math.min(values.length, end);
  if (to <= from) return { min: 0, max: 0 };
  let min = values[from];
  let max = values[from];
  for (let i = from + 1; i < to; i += 1) {
    const v = values[i];
    if (v < min) min = v;
    else if (v > max) max = v;
  }
  return { min, max };
}
