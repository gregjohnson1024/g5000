import type { LatLon } from './types.js';

const R = 6371008.8; // mean Earth radius, meters
const DEG = Math.PI / 180;

export function normalizeAngle(rad: number): number {
  let a = rad;
  while (a > Math.PI) a -= 2 * Math.PI;
  while (a < -Math.PI) a += 2 * Math.PI;
  return a;
}

export function normalizeBearing(rad: number): number {
  const two = 2 * Math.PI;
  return ((rad % two) + two) % two;
}

export function greatCircleDistance(a: LatLon, b: LatLon): number {
  const φ1 = a.lat * DEG, φ2 = b.lat * DEG;
  const Δφ = (b.lat - a.lat) * DEG;
  const Δλ = (b.lon - a.lon) * DEG;
  const h =
    Math.sin(Δφ / 2) ** 2 +
    Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

export function greatCircleBearing(a: LatLon, b: LatLon): number {
  const φ1 = a.lat * DEG, φ2 = b.lat * DEG;
  const Δλ = (b.lon - a.lon) * DEG;
  const y = Math.sin(Δλ) * Math.cos(φ2);
  const x =
    Math.cos(φ1) * Math.sin(φ2) -
    Math.sin(φ1) * Math.cos(φ2) * Math.cos(Δλ);
  return normalizeBearing(Math.atan2(y, x));
}

/**
 * Move along a rhumb line by `distance_m` at `bearing` (radians from north,
 * clockwise). Returns new lat/lon in degrees. For short steps (≤ a few hundred
 * km) this is indistinguishable from great-circle propagation.
 */
export function rhumbStep(start: LatLon, distance_m: number, bearing: number): LatLon {
  const δ = distance_m / R;
  const φ1 = start.lat * DEG;
  const λ1 = start.lon * DEG;
  const Δφ = δ * Math.cos(bearing);
  const φ2 = φ1 + Δφ;
  const Δψ = Math.log(
    Math.tan(Math.PI / 4 + φ2 / 2) / Math.tan(Math.PI / 4 + φ1 / 2),
  );
  const q = Math.abs(Δψ) > 1e-12 ? Δφ / Δψ : Math.cos(φ1);
  const Δλ = (δ * Math.sin(bearing)) / q;
  const λ2 = λ1 + Δλ;
  return {
    lat: φ2 / DEG,
    lon: (((λ2 / DEG) + 540) % 360) - 180,
  };
}
