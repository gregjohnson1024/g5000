import type { WindField, CurrentField } from './types.js';

/** Trilinear interpolation of u/v at (lat, lon, t). Throws if outside grid. */
export function interpolateWind(
  field: WindField,
  lat: number,
  lon: number,
  t: number,
): { u: number; v: number } {
  return trilinear(field, lat, lon, t);
}

export function interpolateCurrent(
  field: CurrentField,
  lat: number,
  lon: number,
  t: number,
): { u: number; v: number } {
  return trilinear(field, lat, lon, t);
}

function trilinear(
  field: WindField | CurrentField,
  lat: number,
  lon: number,
  t: number,
): { u: number; v: number } {
  const ti = locate(field.times, t);
  const yi = locate(field.lats, lat);
  const xi = locate(field.lons, lon);
  const ft = frac(field.times, t, ti);
  const fy = frac(field.lats, lat, yi);
  const fx = frac(field.lons, lon, xi);

  const interpAt = (grid: number[][][]): number => {
    const c000 = grid[ti.lo]![yi.lo]![xi.lo]!;
    const c001 = grid[ti.lo]![yi.lo]![xi.hi]!;
    const c010 = grid[ti.lo]![yi.hi]![xi.lo]!;
    const c011 = grid[ti.lo]![yi.hi]![xi.hi]!;
    const c100 = grid[ti.hi]![yi.lo]![xi.lo]!;
    const c101 = grid[ti.hi]![yi.lo]![xi.hi]!;
    const c110 = grid[ti.hi]![yi.hi]![xi.lo]!;
    const c111 = grid[ti.hi]![yi.hi]![xi.hi]!;
    const c00 = c000 * (1 - fx) + c001 * fx;
    const c01 = c010 * (1 - fx) + c011 * fx;
    const c10 = c100 * (1 - fx) + c101 * fx;
    const c11 = c110 * (1 - fx) + c111 * fx;
    const c0 = c00 * (1 - fy) + c01 * fy;
    const c1 = c10 * (1 - fy) + c11 * fy;
    return c0 * (1 - ft) + c1 * ft;
  };

  return { u: interpAt(field.u), v: interpAt(field.v) };
}

function locate(bins: number[], v: number): { lo: number; hi: number } {
  if (bins.length < 2) throw new Error('interpolate: grid axis must have ≥2 points');
  if (v < bins[0]! || v > bins[bins.length - 1]!) {
    throw new Error(`interpolate: value ${v} out of range [${bins[0]}, ${bins[bins.length - 1]}]`);
  }
  for (let i = 0; i < bins.length - 1; i++) {
    if (v >= bins[i]! && v <= bins[i + 1]!) return { lo: i, hi: i + 1 };
  }
  // Unreachable given the range check, but keeps TS happy.
  throw new Error('interpolate: locate fell through');
}

function frac(bins: number[], v: number, idx: { lo: number; hi: number }): number {
  const lo = bins[idx.lo]!;
  const hi = bins[idx.hi]!;
  return hi === lo ? 0 : (v - lo) / (hi - lo);
}
