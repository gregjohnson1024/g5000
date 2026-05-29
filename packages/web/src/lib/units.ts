/**
 * Unit conversions and compass helpers shared across web pages.
 *
 * Knot/metre-per-second factors and the 16-point cardinal lookup are
 * copied verbatim from the canonical call sites so behaviour is
 * byte-identical to the local copies these replace.
 */

/** metres-per-second → knots */
export const MS_TO_KN = 1 / 0.514444;
/** knots → metres-per-second */
export const KN_TO_MS = 0.514444;
/** radians → degrees */
export const RAD_TO_DEG = 180 / Math.PI;

/** Normalise an angle in degrees to [0, 360). */
export function wrap360(deg: number): number {
  return ((deg % 360) + 360) % 360;
}

/** 16-point compass abbreviation for a bearing in degrees. */
export function cardinal16(deg: number): string {
  const pts = [
    'N',
    'NNE',
    'NE',
    'ENE',
    'E',
    'ESE',
    'SE',
    'SSE',
    'S',
    'SSW',
    'SW',
    'WSW',
    'W',
    'WNW',
    'NW',
    'NNW',
  ];
  return pts[Math.round(deg / 22.5) % 16]!;
}
