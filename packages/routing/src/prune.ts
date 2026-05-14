import type { LatLon } from './types.js';
import { greatCircleBearing, greatCircleDistance } from './geometry.js';

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
 *
 * "Furthest" is measured as the great-circle distance from `start` to the
 * node's current position — NOT the accumulated path length the node took
 * to get there. The accumulated metric (FrontierNode.distFromStart) lets
 * A→B→A→B oscillation inflate without spatial progress: every step adds
 * water distance even when the boat ends up where it started. Straight-line
 * distance from start can't be inflated that way, so oscillating nodes
 * lose to genuine progress in their bucket.
 */
export function pruneByBearingBucket(
  frontier: FrontierNode[],
  start: LatLon,
  bucketDeg: number,
): FrontierNode[] {
  if (frontier.length === 0) return [];
  const bucketRad = (bucketDeg * Math.PI) / 180;
  const buckets = new Map<number, { node: FrontierNode; dist: number }>();
  for (const n of frontier) {
    const bearing = greatCircleBearing(start, n.pos);
    const key = Math.floor(bearing / bucketRad);
    const dist = greatCircleDistance(start, n.pos);
    const existing = buckets.get(key);
    if (!existing || dist > existing.dist) {
      buckets.set(key, { node: n, dist });
    }
  }
  return [...buckets.values()].map((b) => b.node);
}
