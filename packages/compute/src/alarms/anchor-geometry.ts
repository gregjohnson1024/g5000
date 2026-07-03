/**
 * Anchor-watch geometry: pure spherical helpers shared by the anchor-watch
 * predicate and the /api/alarms/anchor route.
 *
 * The watch zone is a circle of `radiusM` around the (resolved) anchor
 * position, optionally cut down to a sector: when `coneDeg < 360`, the boat
 * must also sit within ±coneDeg/2 of `coneCenterDeg` as seen FROM the anchor.
 * A boat outside the sector is a breach even inside the radius — that is the
 * point of the sector: it catches the anchor dragging up-wind/up-current
 * long before the swing circle is exceeded.
 */

const R = 6371_008.8; // mean Earth radius, metres — matches haversine users elsewhere

const toRad = (d: number): number => (d * Math.PI) / 180;
const toDeg = (r: number): number => (r * 180) / Math.PI;

export interface GeoPoint {
  lat: number;
  lon: number;
}

/** Great-circle distance in metres. */
export function haversineMeters(a: GeoPoint, b: GeoPoint): number {
  const dLat = toRad(b.lat - a.lat);
  const dLon = toRad(b.lon - a.lon);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h = Math.sin(dLat / 2) ** 2 + Math.sin(dLon / 2) ** 2 * Math.cos(lat1) * Math.cos(lat2);
  return 2 * R * Math.asin(Math.sqrt(h));
}

/** Initial (forward) great-circle bearing from `a` to `b`, degrees 0..360 true. */
export function initialBearingDeg(a: GeoPoint, b: GeoPoint): number {
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const dLon = toRad(b.lon - a.lon);
  const y = Math.sin(dLon) * Math.cos(lat2);
  const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLon);
  return (toDeg(Math.atan2(y, x)) + 360) % 360;
}

/** Spherical forward geodesic: the point `distM` metres from (lat, lon) along `bearingDeg`. */
export function projectPoint(
  lat: number,
  lon: number,
  bearingDeg: number,
  distM: number,
): GeoPoint {
  const delta = distM / R;
  const theta = toRad(bearingDeg);
  const lat1 = toRad(lat);
  const lon1 = toRad(lon);
  const lat2 = Math.asin(
    Math.sin(lat1) * Math.cos(delta) + Math.cos(lat1) * Math.sin(delta) * Math.cos(theta),
  );
  const lon2 =
    lon1 +
    Math.atan2(
      Math.sin(theta) * Math.sin(delta) * Math.cos(lat1),
      Math.cos(delta) - Math.sin(lat1) * Math.sin(lat2),
    );
  // Normalise longitude to -180..180 so a projection across the antimeridian stays sane.
  const lonDeg = ((toDeg(lon2) + 540) % 360) - 180;
  return { lat: toDeg(lat2), lon: lonDeg };
}

/** Smallest absolute difference between two bearings, degrees 0..180 (handles the 0/360 seam). */
export function bearingDeltaDeg(a: number, b: number): number {
  const d = Math.abs((((a - b) % 360) + 360) % 360);
  return d > 180 ? 360 - d : d;
}

/**
 * Breach predicate for the watch zone.
 *
 * Breach when the boat is farther than `radiusM` from the anchor, OR when a
 * sector is configured (`coneDeg < 360` with a `coneCenterDeg`) and the
 * bearing anchor→boat falls outside ±coneDeg/2 of the sector centre.
 * `coneDeg` undefined means full circle (360°). A boat sitting exactly on the
 * anchor point has no defined bearing and is never a sector breach.
 */
export function isBreached(
  anchorPoint: GeoPoint,
  radiusM: number,
  coneDeg: number | undefined,
  coneCenterDeg: number | undefined,
  boatPos: GeoPoint,
): boolean {
  const distanceM = haversineMeters(anchorPoint, boatPos);
  if (distanceM > radiusM) return true;
  const cone = coneDeg ?? 360;
  if (cone >= 360 || coneCenterDeg === undefined) return false;
  if (distanceM < 0.5) return false; // on top of the anchor — bearing is meaningless
  const brg = initialBearingDeg(anchorPoint, boatPos);
  return bearingDeltaDeg(brg, coneCenterDeg) > cone / 2;
}
