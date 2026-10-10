/**
 * Charts show counts. A value that is negative or not finite (NaN, Infinity) is treated as 0
 * everywhere it appears: bar size, label, legend, percentage and table cell.
 */
export function count(v: number): number {
  return Number.isFinite(v) && v > 0 ? v : 0;
}
