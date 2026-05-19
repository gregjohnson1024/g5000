import type { Coastline } from './types.js';
import { pointInRing, segmentCrossesRing, type Point } from './geometry.js';

export function isOnLand(c: Coastline, lat: number, lon: number): boolean {
  const candidates = c.index.search({
    minX: lon,
    minY: lat,
    maxX: lon,
    maxY: lat,
  });
  for (const cand of candidates) {
    if (pointInRing([lon, lat], cand.polygon.ring)) return true;
  }
  return false;
}

export function intersectsLand(
  c: Coastline,
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number,
): boolean {
  const minX = Math.min(lon1, lon2);
  const maxX = Math.max(lon1, lon2);
  const minY = Math.min(lat1, lat2);
  const maxY = Math.max(lat1, lat2);
  const candidates = c.index.search({ minX, minY, maxX, maxY });
  const a: Point = [lon1, lat1];
  const b: Point = [lon2, lat2];
  for (const cand of candidates) {
    if (segmentCrossesRing(a, b, cand.polygon.ring)) return true;
  }
  return false;
}
