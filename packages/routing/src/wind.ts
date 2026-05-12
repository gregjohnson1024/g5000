import { normalizeAngle, normalizeBearing } from './geometry.js';

/**
 * Decompose a wind vector (u, v) in m/s into:
 *   - tws: scalar wind speed, m/s
 *   - twd: true wind direction in radians from north, clockwise — the
 *          direction the wind is COMING FROM (meteorological convention).
 *
 * Meteorology convention: u > 0 means wind blows toward the east.
 * "from" direction = atan2(-u, -v) normalized to [0, 2π).
 */
export function decomposeWind(u: number, v: number): { tws: number; twd: number } {
  return {
    tws: Math.hypot(u, v),
    twd: normalizeBearing(Math.atan2(-u, -v)),
  };
}

/**
 * Signed true wind angle: positive = wind on starboard, negative = port.
 * Polar lookup uses |TWA|.
 */
export function twaFromWindAndHeading(twd: number, heading: number): number {
  return normalizeAngle(twd - heading);
}
