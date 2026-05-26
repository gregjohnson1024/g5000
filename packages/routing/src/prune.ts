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
  cog: number;
  twa: number;
  tack?: 'port' | 'starboard';
  motoring?: boolean;
  tws: number;
  bsp: number;
  sogGround: number;
  distFromStart: number;
}

/**
 * Bucket frontier nodes by bearing-from-start at `bucketDeg` resolution;
 * within each bucket keep the node CLOSEST to the destination (smallest
 * remaining great-circle distance to `end`).
 *
 * Bearing-from-start bucketing preserves the angular fan of exploration so
 * detours (tacking upwind, rounding an obstacle, riding a favourable current
 * band) survive in their own sectors. The within-bucket key — remaining
 * distance to `end` — rewards progress toward the goal rather than raw
 * displacement.
 *
 * The earlier key, "furthest from start", actively prevented the final
 * convergence: once a node sat just past the destination (further from
 * start than the target), the converging child that stepped back toward the
 * destination was *closer to start* and lost its bucket to the overshooter,
 * so the frontier could only sail past the goal, never close on it. Ranking
 * by remaining-distance-to-end makes the converging child win and terminate.
 *
 * Remaining-distance-to-end is also robust to the A→B→A→B oscillation that
 * the accumulated path length (FrontierNode.distFromStart) was vulnerable
 * to: bouncing in place doesn't reduce the distance to the destination, so
 * oscillating nodes never beat genuine progress.
 */
export function pruneByBearingBucket(
  frontier: FrontierNode[],
  start: LatLon,
  end: LatLon,
  bucketDeg: number,
): FrontierNode[] {
  if (frontier.length === 0) return [];
  const bucketRad = (bucketDeg * Math.PI) / 180;
  const buckets = new Map<number, { node: FrontierNode; remaining: number }>();
  for (const n of frontier) {
    const bearing = greatCircleBearing(start, n.pos);
    const key = Math.floor(bearing / bucketRad);
    const remaining = greatCircleDistance(n.pos, end);
    const existing = buckets.get(key);
    if (!existing || remaining < existing.remaining) {
      buckets.set(key, { node: n, remaining });
    }
  }
  return [...buckets.values()].map((b) => b.node);
}
