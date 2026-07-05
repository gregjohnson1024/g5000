import type { AisTarget } from '@g5000/core';

export interface RankedVessel {
  mmsi: number;
  name: string | null;
  rangeM: number | null;
  ageMs: number;
}

const R = 6371008.8;
const toRad = (d: number) => (d * Math.PI) / 180;

function haversineM(a: { lat: number; lon: number }, b: { lat: number; lon: number }): number {
  const dLat = toRad(b.lat - a.lat),
    dLon = toRad(b.lon - a.lon);
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(s)));
}

export function rankVessels(
  targets: AisTarget[],
  own: { lat: number; lon: number } | null,
  now: number,
): RankedVessel[] {
  return targets
    .map((t) => ({
      mmsi: t.mmsi,
      name: t.name ?? null,
      rangeM:
        own && t.lat != null && t.lon != null ? haversineM(own, { lat: t.lat, lon: t.lon }) : null,
      ageMs: now - t.lastSeenMs,
    }))
    .sort((a, b) => (a.rangeM ?? Infinity) - (b.rangeM ?? Infinity));
}
