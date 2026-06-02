import type { Station } from './types.js';

const R_KM = 6371;
const toRad = (d: number): number => (d * Math.PI) / 180;

/** Great-circle distance in km. */
export function haversineKm(aLat: number, aLon: number, bLat: number, bLon: number): number {
  const dLat = toRad(bLat - aLat);
  const dLon = toRad(bLon - aLon);
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(aLat)) * Math.cos(toRad(bLat)) * Math.sin(dLon / 2) ** 2;
  return 2 * R_KM * Math.asin(Math.min(1, Math.sqrt(s)));
}

/**
 * Nearest station to `pos`, with hysteresis: if `current` is provided, only
 * switch to a different station when it is closer by more than `switchMarginKm`
 * (prevents GPS-jitter flapping at a Voronoi boundary). Returns null for an
 * empty list.
 */
export function nearestStation(
  stations: ReadonlyArray<Station>,
  pos: { lat: number; lon: number },
  current: Station | null,
  switchMarginKm = 2,
): Station | null {
  if (stations.length === 0) return null;
  let best = stations[0]!;
  let bestD = haversineKm(pos.lat, pos.lon, best.lat, best.lon);
  for (const s of stations) {
    const d = haversineKm(pos.lat, pos.lon, s.lat, s.lon);
    if (d < bestD) {
      best = s;
      bestD = d;
    }
  }
  if (!current) return best;
  if (best.id === current.id) return current;
  const curD = haversineKm(pos.lat, pos.lon, current.lat, current.lon);
  return bestD <= curD - switchMarginKm ? best : current;
}
