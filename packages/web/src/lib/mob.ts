/**
 * MOB (man overboard) geodesy helpers.
 *
 * Thin object-parameter wrappers over the canonical implementations in
 * `geo.ts`, so MOB callers (MobLayer's bearing/distance readout) share
 * byte-identical maths with the rest of the chart instead of growing a
 * third haversine copy.
 */
import { haversineM as haversineMFlat, bearingDeg } from './geo';

export interface MobPoint {
  lat: number;
  lon: number;
}

/** Great-circle distance in metres (R = 6_371_000 m). */
export function haversineM(a: MobPoint, b: MobPoint): number {
  return haversineMFlat(a.lat, a.lon, b.lat, b.lon);
}

/** Initial (forward) great-circle bearing from `a` to `b`, degrees 0..360 true. */
export function initialBearingDeg(a: MobPoint, b: MobPoint): number {
  return bearingDeg(a, b);
}
