/**
 * Race-subpath-internal geometry helpers.
 *
 * This module is deliberately NOT exported from the compute package root
 * barrel (`packages/compute/src/index.ts`) NOR from the race barrel
 * (`race/index.ts`). It is imported only by sibling modules inside
 * `packages/compute/src/race/`, keeping the race subpath self-contained and
 * the root export free of any grib / node:path chain.
 *
 * Pure math only — no I/O, no cross-package imports.
 */

import type { LatLon } from './line-geometry.js';

const R_EARTH_M = 6_371_000;
const TWO_PI = 2 * Math.PI;

/**
 * Great-circle destination point: project from `start` along initial bearing
 * `bearingRad` (radians) for `distanceM` meters. Returns the {lat, lon}
 * (degrees) of the destination.
 *
 * Canonical copy consolidated from the previously-duplicated `project()`
 * (race/laylines.ts) and `projectGreatCircle()` (race/ocs-predictor.ts);
 * both used the identical formula and the same Earth radius (6_371_000 m).
 */
export function projectGreatCircle(start: LatLon, bearingRad: number, distanceM: number): LatLon {
  const δ = distanceM / R_EARTH_M;
  const φ1 = (start.lat * Math.PI) / 180;
  const λ1 = (start.lon * Math.PI) / 180;
  const φ2 = Math.asin(
    Math.sin(φ1) * Math.cos(δ) + Math.cos(φ1) * Math.sin(δ) * Math.cos(bearingRad),
  );
  const λ2 =
    λ1 +
    Math.atan2(
      Math.sin(bearingRad) * Math.sin(δ) * Math.cos(φ1),
      Math.cos(δ) - Math.sin(φ1) * Math.sin(φ2),
    );
  return { lat: (φ2 * 180) / Math.PI, lon: (λ2 * 180) / Math.PI };
}

/**
 * Normalize an angle (radians) to (-π, π].
 *
 * Bit-for-bit equivalent to the open-coded idiom this replaces:
 *   while (d > Math.PI) d -= 2 * Math.PI;
 *   while (d < -Math.PI) d += 2 * Math.PI;
 * (same operation sequence — the callers pass the exact subexpression the
 * loop variable previously held).
 */
export function wrapToPi(d: number): number {
  while (d > Math.PI) d -= TWO_PI;
  while (d < -Math.PI) d += TWO_PI;
  return d;
}

/**
 * Normalize an angle (radians) to [0, 2π).
 *
 * Uses the `(x + 2π) % 2π` form — byte-identical to the previous open-coded
 * expressions at the `initialBearingRad` (line-geometry) and `portHeading`
 * (index) call sites, whose inputs are all bounded > −2π so the single
 * `+2π` guard suffices. (The `stbdHeading` site previously used a bare
 * `% 2π`; routing it here is a ≤1-ULP change in the resulting heading, with
 * 19/1e6 boundary inputs mapping an exact `2π` to `0` — the same physical
 * direction. The value only feeds great-circle trig for a chart layline, so
 * the difference is physically irrelevant. See task report concerns.)
 */
export function wrapTwoPi(x: number): number {
  return (x + TWO_PI) % TWO_PI;
}
