import { wrapToPi } from './geo.js';

/**
 * Velocity Made-good toward a fixed Course. COG and bearing in radians;
 * SOG in any speed unit. Returns the SOG component projected onto the
 * bearing-to-mark vector. Positive = closing the mark; negative = opening.
 */
export function vmc(sog: number, cogRad: number, bearingToMarkRad: number): number {
  const dθ = wrapToPi(cogRad - bearingToMarkRad);
  return sog === 0 ? 0 : sog * Math.cos(dθ);
}
