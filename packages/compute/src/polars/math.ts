import type { PolarTable } from '@g5000/db';
import { bilinearInterpolate2D } from '../grid-interp.js';

/**
 * Bilinear interpolation of target boat speed at (TWS, |TWA|) on a polar grid.
 * Inputs outside the grid are clamped to the nearest edge.
 */
export function interpolatePolarSpeed(polar: PolarTable, tws: number, twaAbs: number): number {
  return bilinearInterpolate2D(polar.twsBins, polar.twaBins, polar.boatSpeed, tws, twaAbs);
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
  let bestTwa =
    direction === 'upwind' ? polar.twaBins[1]! : polar.twaBins[polar.twaBins.length - 2]!;
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
