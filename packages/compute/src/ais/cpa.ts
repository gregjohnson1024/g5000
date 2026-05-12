/**
 * Closest-Point-of-Approach math for AIS collision avoidance.
 *
 * Given own-boat and target lat/lon/cog/sog (degrees + radians + m/s), this
 * computes:
 *   - `rangeMeters`   — current straight-line distance.
 *   - `bearingRadians`— compass bearing from own to target (0 = N, +ve = E).
 *   - `tcpaSeconds`   — seconds until closest approach (negative ⇒ already past).
 *   - `cpaMeters`     — projected minimum distance at that closest approach.
 *
 * Coordinate model: small-area equirectangular projection centered on own.
 * Accurate to well under 1% for sub-100-NM ranges, which is far better than
 * AIS position resolution at that distance. We don't use great-circle math
 * because (a) the boat won't be sailing geodesics for the next 10 minutes,
 * (b) target courses are constant-COG straight lines in the local plane,
 * not great circles, so a planar CPA is what we actually want.
 */

export interface CpaInput {
  /** Latitude in degrees, +N. */
  lat: number;
  /** Longitude in degrees, +E. */
  lon: number;
  /** Course Over Ground, radians (0 = N, π/2 = E). */
  cog: number;
  /** Speed Over Ground, m/s. */
  sog: number;
}

export interface CpaResult {
  /** Closest predicted distance, meters. */
  cpaMeters: number;
  /** Seconds until that closest distance; negative means it already happened. */
  tcpaSeconds: number;
  /** Current straight-line range, meters. */
  rangeMeters: number;
  /** Current bearing from own to target, radians (compass: 0 = N, +ve = E). */
  bearingRadians: number;
}

/**
 * Meters per degree of latitude. Constant within our equirectangular model.
 * Mean-radius value (WGS84 gives 111,132 m at the equator and 111,694 m at
 * the poles; the difference is well inside the noise band of any of our
 * inputs).
 */
const M_PER_DEG_LAT = 111_320;

export function computeCpa(own: CpaInput, target: CpaInput): CpaResult {
  // East-west scale depends on latitude — at lat 60° N a degree of longitude
  // is half a degree of latitude in meters.
  const ownLatRad = (own.lat * Math.PI) / 180;
  const mPerDegLon = M_PER_DEG_LAT * Math.cos(ownLatRad);

  // Local x/y of target with own at the origin. East-positive x, north-positive y.
  const rx = (target.lon - own.lon) * mPerDegLon;
  const ry = (target.lat - own.lat) * M_PER_DEG_LAT;

  // COG → math vector: x = east = sog * sin(cog), y = north = sog * cos(cog).
  const ownVx = own.sog * Math.sin(own.cog);
  const ownVy = own.sog * Math.cos(own.cog);
  const tgtVx = target.sog * Math.sin(target.cog);
  const tgtVy = target.sog * Math.cos(target.cog);

  // Relative velocity (target minus own).
  const rvx = tgtVx - ownVx;
  const rvy = tgtVy - ownVy;
  const relSpeedSq = rvx * rvx + rvy * rvy;

  // Time-to-CPA: minimise |r + t*v|² → t = -(r·v) / |v|². Zero relative
  // motion means the boats are travelling together — CPA equals current range
  // and tcpa is undefined (we return 0 so the caller sees a sensible answer).
  let tcpa: number;
  if (relSpeedSq < 1e-9) {
    tcpa = 0;
  } else {
    tcpa = -(rx * rvx + ry * rvy) / relSpeedSq;
  }

  // Closest position (in our local frame), and its distance.
  const cpaX = rx + tcpa * rvx;
  const cpaY = ry + tcpa * rvy;
  const cpa = Math.sqrt(cpaX * cpaX + cpaY * cpaY);

  const range = Math.sqrt(rx * rx + ry * ry);

  // Bearing from own to target in compass convention (0 = N, increasing east).
  // atan2(east, north) gives compass radians; wrap into [0, 2π).
  const bearing = Math.atan2(rx, ry);
  const bearingWrapped = ((bearing % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);

  return {
    cpaMeters: cpa,
    tcpaSeconds: tcpa,
    rangeMeters: range,
    bearingRadians: bearingWrapped,
  };
}
