import type { PolarTable } from '@g5000/db';

/**
 * Bilinear interpolation of target boat speed at (TWS, |TWA|) on a polar grid.
 * Inputs outside the grid are clamped to the nearest edge.
 */
export function interpolatePolarSpeed(
  polar: PolarTable,
  tws: number,
  twaAbs: number,
): number {
  return bilinear(polar.twsBins, polar.twaBins, polar.boatSpeed, tws, twaAbs);
}

/**
 * Signed VMG: positive = upwind component, negative = downwind component.
 * Equivalent to bsp * cos(TWA); positive TWA above π/2 yields negative VMG.
 */
export function vmgFor(bsp: number, twa: number): number {
  return bsp * Math.cos(twa);
}

/**
 * For a given TWS, find the TWA (radians) that maximizes |VMG| in the
 * requested direction. Scans the polar's TWA bins for the row interpolated
 * to the requested TWS. Coarse — fine enough for Phase 0 display purposes;
 * a continuous solver would refine this further.
 */
export function optimalTwaForVmg(
  polar: PolarTable,
  tws: number,
  direction: 'upwind' | 'downwind',
): number {
  let bestTwa = direction === 'upwind' ? polar.twaBins[1]! : polar.twaBins[polar.twaBins.length - 2]!;
  let bestVmg = -Infinity;
  for (const twa of polar.twaBins) {
    if (direction === 'upwind' && twa >= Math.PI / 2) continue;
    if (direction === 'downwind' && twa <= Math.PI / 2) continue;
    const bsp = interpolatePolarSpeed(polar, tws, twa);
    // For "best upwind" we want the largest +VMG; for "best downwind"
    // we want the largest |negative VMG|, i.e. the most negative VMG
    // → equivalent to largest +VMG against the wind-from-behind, i.e.
    // largest bsp·|cos(twa)|. We optimise the magnitude.
    const vmg = direction === 'upwind' ? bsp * Math.cos(twa) : -bsp * Math.cos(twa);
    if (vmg > bestVmg) {
      bestVmg = vmg;
      bestTwa = twa;
    }
  }
  return bestTwa;
}

function bilinear(
  xBins: number[],
  yBins: number[],
  grid: number[][],
  x: number,
  y: number,
): number {
  const xi = locate(xBins, x);
  const yi = locate(yBins, y);
  const x0 = xBins[xi.lo]!;
  const x1 = xBins[xi.hi]!;
  const y0 = yBins[yi.lo]!;
  const y1 = yBins[yi.hi]!;
  const fx = x1 === x0 ? 0 : (x - x0) / (x1 - x0);
  const fy = y1 === y0 ? 0 : (y - y0) / (y1 - y0);
  const c00 = grid[xi.lo]![yi.lo]!;
  const c01 = grid[xi.lo]![yi.hi]!;
  const c10 = grid[xi.hi]![yi.lo]!;
  const c11 = grid[xi.hi]![yi.hi]!;
  return (
    c00 * (1 - fx) * (1 - fy) +
    c10 * fx * (1 - fy) +
    c01 * (1 - fx) * fy +
    c11 * fx * fy
  );
}

function locate(bins: number[], v: number): { lo: number; hi: number } {
  if (bins.length === 0) return { lo: 0, hi: 0 };
  if (v <= bins[0]!) return { lo: 0, hi: 0 };
  if (v >= bins[bins.length - 1]!) {
    return { lo: bins.length - 1, hi: bins.length - 1 };
  }
  for (let i = 0; i < bins.length - 1; i++) {
    if (v >= bins[i]! && v <= bins[i + 1]!) return { lo: i, hi: i + 1 };
  }
  return { lo: bins.length - 1, hi: bins.length - 1 };
}
