/**
 * Geodesic helpers shared across web pages.
 *
 * Two distance conventions live here on purpose:
 *  - {@link greatCircleNm} / {@link bearingDeg} work in nautical miles
 *    (R = 3440.065 NM) for nav/passage maths.
 *  - {@link haversineM} works in metres (R = 6_371_000 m) for track
 *    over-ground path-length sums.
 *
 * Bodies are copied verbatim from the canonical call sites so behaviour
 * is byte-identical to the local copies these replace.
 */

/** Great-circle distance in nautical miles (R = 3440.065 NM). */
export function greatCircleNm(
  a: { lat: number; lon: number },
  b: { lat: number; lon: number },
): number {
  const R_NM = 3440.065;
  const toRad = (d: number): number => (d * Math.PI) / 180;
  const p1 = toRad(a.lat);
  const p2 = toRad(b.lat);
  const dp = toRad(b.lat - a.lat);
  const dl = toRad(b.lon - a.lon);
  const x = Math.sin(dp / 2) ** 2 + Math.cos(p1) * Math.cos(p2) * Math.sin(dl / 2) ** 2;
  return 2 * R_NM * Math.asin(Math.min(1, Math.sqrt(x)));
}

/** Initial (forward) great-circle bearing in degrees, 0..360 true. */
export function bearingDeg(
  a: { lat: number; lon: number },
  b: { lat: number; lon: number },
): number {
  const toRad = (d: number): number => (d * Math.PI) / 180;
  const p1 = toRad(a.lat);
  const p2 = toRad(b.lat);
  const dl = toRad(b.lon - a.lon);
  const y = Math.sin(dl) * Math.cos(p2);
  const x = Math.cos(p1) * Math.sin(p2) - Math.sin(p1) * Math.cos(p2) * Math.cos(dl);
  return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
}

/** Haversine distance in metres (R = 6_371_000 m). */
export function haversineM(aLat: number, aLon: number, bLat: number, bLon: number): number {
  const R_M = 6_371_000;
  const dLat = ((bLat - aLat) * Math.PI) / 180;
  const dLon = ((bLon - aLon) * Math.PI) / 180;
  const φ1 = (aLat * Math.PI) / 180;
  const φ2 = (bLat * Math.PI) / 180;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(φ1) * Math.cos(φ2) * Math.sin(dLon / 2) ** 2;
  return 2 * R_M * Math.asin(Math.min(1, Math.sqrt(h)));
}
