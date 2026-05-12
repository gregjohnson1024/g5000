import type { LatLon } from './types.js';
import { greatCircleBearing } from './geometry.js';

/**
 * Internal frontier-node shape. We export it from this file so prune can be
 * unit-tested in isolation; the planner module produces these.
 */
export interface FrontierNode {
  pos: LatLon;
  t: number;
  parent: FrontierNode | null;
  heading: number;
  twa: number;
  tws: number;
  bsp: number;
  sogGround: number;
  distFromStart: number;
}

/**
 * Bucket frontier nodes by bearing-from-start at `bucketDeg` resolution;
 * keep the one furthest from start per bucket.
 */
export function pruneByBearingBucket(
  frontier: FrontierNode[],
  start: LatLon,
  bucketDeg: number,
): FrontierNode[] {
  if (frontier.length === 0) return [];
  const bucketRad = (bucketDeg * Math.PI) / 180;
  const buckets = new Map<number, FrontierNode>();
  for (const n of frontier) {
    const bearing = greatCircleBearing(start, n.pos);
    const key = Math.floor(bearing / bucketRad);
    const existing = buckets.get(key);
    if (!existing || n.distFromStart > existing.distFromStart) {
      buckets.set(key, n);
    }
  }
  return [...buckets.values()];
}
