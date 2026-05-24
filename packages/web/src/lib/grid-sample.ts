/**
 * A 2-D field on an ascending lat/lon grid. Both the chart's WindGrid and
 * CurrentGrid match this shape, so the sampler serves either.
 */
export interface UvGrid {
  lats: number[]; // ascending
  lons: number[]; // ascending
  u: number[][]; // [latIdx][lonIdx]
  v: number[][];
}

/** Largest index `i` with `arr[i] <= x`, for an ascending array; -1 if x < arr[0]. */
function lowerIndex(arr: number[], x: number): number {
  let lo = 0;
  let hi = arr.length - 1;
  if (x < arr[0]!) return -1;
  if (x >= arr[hi]!) return hi;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (arr[mid]! <= x) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}

/**
 * Bilinearly interpolate `u`/`v` at (lat, lon). Returns null when the point is
 * outside the grid's coverage or any of the four surrounding samples is
 * non-finite (grid edge / masked cell) — callers should then show nothing
 * rather than a misleading extrapolation.
 */
export function sampleUV(grid: UvGrid, lat: number, lon: number): { u: number; v: number } | null {
  const { lats, lons, u, v } = grid;
  if (lats.length < 2 || lons.length < 2) return null;
  if (lat < lats[0]! || lat > lats[lats.length - 1]!) return null;
  if (lon < lons[0]! || lon > lons[lons.length - 1]!) return null;

  const y0 = Math.min(lowerIndex(lats, lat), lats.length - 2);
  const x0 = Math.min(lowerIndex(lons, lon), lons.length - 2);
  const y1 = y0 + 1;
  const x1 = x0 + 1;

  const latSpan = lats[y1]! - lats[y0]!;
  const lonSpan = lons[x1]! - lons[x0]!;
  const fy = latSpan > 0 ? (lat - lats[y0]!) / latSpan : 0;
  const fx = lonSpan > 0 ? (lon - lons[x0]!) / lonSpan : 0;

  const interp = (f: number[][]): number | null => {
    const a = f[y0]?.[x0];
    const b = f[y0]?.[x1];
    const c = f[y1]?.[x0];
    const d = f[y1]?.[x1];
    if (![a, b, c, d].every((n) => typeof n === 'number' && Number.isFinite(n))) return null;
    const top = a! * (1 - fx) + b! * fx;
    const bot = c! * (1 - fx) + d! * fx;
    return top * (1 - fy) + bot * fy;
  };

  const uu = interp(u);
  const vv = interp(v);
  if (uu === null || vv === null) return null;
  return { u: uu, v: vv };
}
