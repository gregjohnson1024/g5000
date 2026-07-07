/**
 * plot-scale.ts — Y-axis domain and tick helpers for TimeSeriesPanel.
 *
 * Rules enforced here:
 *  - An explicit `domain` prop always wins (kills the ±0.1°-renders-as-drama bug).
 *  - Auto-fit pads ~10% and enforces a minimum visible span (1 unit).
 *  - Exactly 3 y-ticks are produced: min, mid, max of the domain.
 *
 * Everything here is a pure function — no React, no DOM.
 */

export interface YDomain {
  min: number;
  max: number;
}

/** Minimum visible span for auto-fit (prevents ±0.1 noise exploding). */
const MIN_SPAN = 1;

/**
 * Compute a nice y-domain from data values, respecting an optional fixed domain.
 *
 * @param values   all numeric values in the dataset (may be empty)
 * @param fixed    if provided, this domain is used verbatim (no auto-fit)
 */
export function computeYDomain(values: readonly number[], fixed?: [number, number]): YDomain {
  if (fixed) {
    return { min: fixed[0], max: fixed[1] };
  }
  if (values.length === 0) {
    return { min: 0, max: 1 };
  }
  const raw_min = Math.min(...values);
  const raw_max = Math.max(...values);
  const dataSpan = raw_max - raw_min;
  const pad = dataSpan > 0 ? dataSpan * 0.1 : 0.5;
  const candidate = {
    min: raw_min - pad,
    max: raw_max + pad,
  };
  // Enforce minimum visible span on the final domain.
  const candidateSpan = candidate.max - candidate.min;
  if (candidateSpan < MIN_SPAN) {
    const mid = (candidate.min + candidate.max) / 2;
    return { min: mid - MIN_SPAN / 2, max: mid + MIN_SPAN / 2 };
  }
  return candidate;
}

/**
 * Produce exactly 3 y-tick values for a domain: [min, midpoint, max].
 * Values are rounded to at most 4 significant digits.
 */
export function yTicks(domain: YDomain): [number, number, number] {
  const mid = (domain.min + domain.max) / 2;
  return [domain.min, mid, domain.max];
}

/**
 * Map a data value to an SVG y-coordinate within a plot area.
 *
 * @param v       the data value
 * @param domain  the y-domain
 * @param plotTop SVG y of the top of the plot area
 * @param plotH   height of the plot area in SVG units
 */
export function yCoord(v: number, domain: YDomain, plotTop: number, plotH: number): number {
  const span = Math.max(1e-6, domain.max - domain.min);
  return plotTop + (1 - (v - domain.min) / span) * plotH;
}

/**
 * Map a timestamp to an SVG x-coordinate within a plot area.
 *
 * @param tMs    timestamp in milliseconds
 * @param tMin   start of x-domain
 * @param tMax   end of x-domain
 * @param plotLeft SVG x of the left edge
 * @param plotW  width in SVG units
 */
export function xCoord(
  tMs: number,
  tMin: number,
  tMax: number,
  plotLeft: number,
  plotW: number,
): number {
  const span = Math.max(1, tMax - tMin);
  return plotLeft + ((tMs - tMin) / span) * plotW;
}

/**
 * Format a tick label for display. Shows 1 decimal place for non-integer
 * values less than 100 in magnitude; otherwise integer.
 */
export function fmtTick(v: number): string {
  if (Number.isInteger(v) || Math.abs(v) >= 100) return v.toFixed(0);
  return v.toFixed(1);
}
