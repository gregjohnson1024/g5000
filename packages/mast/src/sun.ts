const DEG = Math.PI / 180;
const RAD = 180 / Math.PI;

/** Approximate solar elevation in degrees for a lat/lon (deg) at a given instant. */
export function solarElevationDeg(latDeg: number, lonDeg: number, when: Date): number {
  // Fractional day of year (UTC).
  const start = Date.UTC(when.getUTCFullYear(), 0, 0);
  const dayMs = when.getTime() - start;
  const dayOfYear = dayMs / 86_400_000;
  const utcHours = when.getUTCHours() + when.getUTCMinutes() / 60 + when.getUTCSeconds() / 3600;

  // Fractional year (radians).
  const gamma = ((2 * Math.PI) / 365) * (dayOfYear - 1 + (utcHours - 12) / 24);

  // Equation of time (minutes) and solar declination (radians) — NOAA approximations.
  const eqTime =
    229.18 *
    (0.000075 +
      0.001868 * Math.cos(gamma) -
      0.032077 * Math.sin(gamma) -
      0.014615 * Math.cos(2 * gamma) -
      0.040849 * Math.sin(2 * gamma));
  const decl =
    0.006918 -
    0.399912 * Math.cos(gamma) +
    0.070257 * Math.sin(gamma) -
    0.006758 * Math.cos(2 * gamma) +
    0.000907 * Math.sin(2 * gamma) -
    0.002697 * Math.cos(3 * gamma) +
    0.00148 * Math.sin(3 * gamma);

  // True solar time (minutes) → hour angle (degrees).
  const timeOffset = eqTime + 4 * lonDeg; // lon east-positive
  const tst = (utcHours * 60 + timeOffset) % 1440;
  const hourAngle = tst / 4 - 180;

  const latRad = latDeg * DEG;
  const haRad = hourAngle * DEG;
  const cosZenith =
    Math.sin(latRad) * Math.sin(decl) + Math.cos(latRad) * Math.cos(decl) * Math.cos(haRad);
  const clamped = Math.max(-1, Math.min(1, cosZenith));
  return 90 - Math.acos(clamped) * RAD;
}

/** Night = sun below civil-twilight threshold (−6°). */
export function isNight(latDeg: number, lonDeg: number, when: Date): boolean {
  return solarElevationDeg(latDeg, lonDeg, when) < -6;
}
