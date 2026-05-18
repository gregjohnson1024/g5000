const EARTH_R_M = 6_371_000;

export interface LatLon {
  lat: number;
  lon: number;
}

function toRad(d: number): number {
  return (d * Math.PI) / 180;
}

/** Great-circle distance in meters. Haversine formula. */
export function haversineMeters(a: LatLon, b: LatLon): number {
  const φ1 = toRad(a.lat);
  const φ2 = toRad(b.lat);
  const dφ = toRad(b.lat - a.lat);
  const dλ = toRad(b.lon - a.lon);
  const x = Math.sin(dφ / 2) ** 2 + Math.cos(φ1) * Math.cos(φ2) * Math.sin(dλ / 2) ** 2;
  return 2 * EARTH_R_M * Math.asin(Math.min(1, Math.sqrt(x)));
}

/** Initial bearing in radians, [0, 2π). True reference (geodesic). */
export function initialBearingRad(a: LatLon, b: LatLon): number {
  const φ1 = toRad(a.lat);
  const φ2 = toRad(b.lat);
  const dλ = toRad(b.lon - a.lon);
  const y = Math.sin(dλ) * Math.cos(φ2);
  const x = Math.cos(φ1) * Math.sin(φ2) - Math.sin(φ1) * Math.cos(φ2) * Math.cos(dλ);
  const θ = Math.atan2(y, x);
  return (θ + 2 * Math.PI) % (2 * Math.PI);
}

/** Bearing from line.port to line.stbd, [0, 2π). */
export function lineBearingRad(port: LatLon, stbd: LatLon): number {
  return initialBearingRad(port, stbd);
}

/**
 * Signed perpendicular distance from boat to the great-circle through port→stbd.
 * Sign convention: positive = boat is on `preStartSide`. The function determines
 * the geometric side via the sign of the cross-track distance (Aviation
 * Formulary §29) and flips to align with the declared preStartSide.
 */
export function distanceToLineMeters(
  boat: LatLon,
  port: LatLon,
  stbd: LatLon,
  preStartSide: 'port' | 'stbd',
): number {
  // Cross-track distance: δ_at = asin(sin(d/R) * sin(θ_pb - θ_pe))
  // d = distance port → boat, θ_pb = bearing port → boat, θ_pe = bearing port → stbd
  const d13 = haversineMeters(port, boat);
  const θ13 = initialBearingRad(port, boat);
  const θ12 = initialBearingRad(port, stbd);
  const δ = Math.asin(Math.sin(d13 / EARTH_R_M) * Math.sin(θ13 - θ12)) * EARTH_R_M;
  // Aviation Formulary convention: δ > 0 when the boat is to the RIGHT of the
  // port→stbd track (i.e. on the starboard side). sideOfLine() returns 'stbd'
  // for that same geometry (cross product < 0 in lon/lat space → 'stbd').
  // Match the sign to preStartSide: return +δ when the boat is on the declared
  // pre-start side, −δ when past the line.
  return preStartSide === 'stbd' ? δ : -δ;
}

/**
 * Determine which side of the port→stbd line the boat is on.
 * Uses a planar cross-product in lon/lat space (valid for start-line
 * distances of < ~10 km).
 *
 * Returns 'stbd' when the boat is to the RIGHT of the port→stbd direction
 * (i.e. the starboard side, δ > 0 from distanceToLineMeters), 'port' otherwise.
 */
export function sideOfLine(boat: LatLon, port: LatLon, stbd: LatLon): 'port' | 'stbd' {
  const cross =
    (stbd.lon - port.lon) * (boat.lat - port.lat) - (stbd.lat - port.lat) * (boat.lon - port.lon);
  return cross > 0 ? 'port' : 'stbd';
}

/**
 * TTL in seconds. Returns null if closing speed ≤ 0 (boat moving away
 * from line or parallel to it).
 *
 * @param dtlMeters signed DTL (positive = pre-start side)
 * @param sogMs SOG in m/s
 * @param closingAngleRad angle between COG and line normal (toward the line).
 *                        0 = heading directly at line; π/2 = parallel.
 */
export function timeToLineSeconds(
  dtlMeters: number,
  sogMs: number,
  closingAngleRad: number,
): number | null {
  // Use a small epsilon to handle floating-point near-zero (e.g. cos(π/2) ≈ 6e-17).
  const closingSpeed = sogMs * Math.cos(closingAngleRad);
  if (closingSpeed < 1e-9) return null;
  return Math.abs(dtlMeters) / closingSpeed;
}

/**
 * Line bias (radians): signed angle of TWD vs the line normal. Positive =
 * port end favored upwind.
 *
 *   normal = lineBearing - π/2  (perpendicular pointing to port-side of line)
 *   bias   = circularDiff(twd, normal + π)  (toward the wind = bias 0 if line is square)
 */
export function lineBiasRad(lineBearingRad: number, twdRad: number): number {
  const normalToward = lineBearingRad - Math.PI / 2; // perpendicular off port end
  // We want bias = 0 when wind comes from the line normal direction
  // (i.e. wind blows perpendicular through the line). Positive bias means
  // wind is rotated toward port end → port is favored.
  let d = twdRad - (normalToward + Math.PI); // from-wind vs the upwind side
  while (d > Math.PI) d -= 2 * Math.PI;
  while (d < -Math.PI) d += 2 * Math.PI;
  return d;
}
