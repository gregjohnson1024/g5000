import type { LatLon } from './line-geometry.js';
import { projectGreatCircle } from './geo.js';

export interface OcsInput {
  pos: LatLon;
  /** Course over ground in radians [0, 2π). */
  cogRad: number;
  /** Speed over ground in m/s. */
  sogMs: number;
  /** COG-stats mean-resultant length, [0, 1]. */
  cogConcentration: number;
  line: { port?: LatLon; stbd?: LatLon };
  /** Epoch ms of the gun, or null when idle. */
  startMs: number | null;
  /** Seconds to project forward. */
  lookAheadSec: number;
}

const MIN_SOG_MS = 0.5 * 0.514444; // 0.5 kn → m/s
const MIN_COG_CONCENTRATION = 0.7;

export function predictOcs(input: OcsInput): boolean | null {
  const { pos, cogRad, sogMs, cogConcentration, line, startMs, lookAheadSec } = input;
  if (startMs === null) return null;
  if (sogMs < MIN_SOG_MS) return null;
  if (cogConcentration < MIN_COG_CONCENTRATION) return null;
  if (!line.port || !line.stbd) return null;

  const secsUntilStart = (startMs - Date.now()) / 1000;
  if (secsUntilStart <= 0) return false; // race is on; not OCS
  if (secsUntilStart > lookAheadSec) return false;

  const projected = projectGreatCircle(pos, cogRad, sogMs * lookAheadSec);
  return segmentsIntersect(pos, projected, line.port, line.stbd);
}

/**
 * 2D segment intersection treating lat/lon as planar over the small scale
 * a race start spans (line ≤ ~1 km; lookahead ≤ ~10 s of motion). At these
 * scales the planar approximation has sub-meter error.
 */
function segmentsIntersect(p1: LatLon, p2: LatLon, p3: LatLon, p4: LatLon): boolean {
  const d1x = p2.lon - p1.lon;
  const d1y = p2.lat - p1.lat;
  const d2x = p4.lon - p3.lon;
  const d2y = p4.lat - p3.lat;
  const denom = d1x * d2y - d1y * d2x;
  if (Math.abs(denom) < 1e-12) return false; // parallel
  const sx = p3.lon - p1.lon;
  const sy = p3.lat - p1.lat;
  const t = (sx * d2y - sy * d2x) / denom;
  const u = (sx * d1y - sy * d1x) / denom;
  return t >= 0 && t <= 1 && u >= 0 && u <= 1;
}
