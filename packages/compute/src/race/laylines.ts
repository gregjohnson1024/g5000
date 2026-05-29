import type { CurrentField } from '@g5000/grib';
import { interpolateCurrent } from '@g5000/grib';
import type { LatLon } from './line-geometry.js';
import { projectGreatCircle } from './geo.js';

export interface LaylineInput {
  pos: LatLon;
  /** Through-water heading in radians [0, 2π). */
  headingRad: number;
  throughWaterSpeedMs: number;
  currentField: CurrentField | null;
  distanceNm: number;
  integrateCurrent: boolean;
  /** Time at which to sample the current field (epoch ms). */
  timeAtSampleMs: number;
}

const NM_TO_M = 1852;
const MAX_SEGMENTS = 20;

/**
 * Project a layline polyline from `pos` along `headingRad`. When
 * `integrateCurrent` is true and `currentField` is non-null, the projection
 * is subdivided into ≤ MAX_SEGMENTS segments and at each segment midpoint
 * the local current vector is composed with the through-water vector to
 * produce the over-ground segment. Otherwise a single great-circle is
 * returned (start, end).
 */
export function projectLayline(input: LaylineInput): LatLon[] {
  const totalM = input.distanceNm * NM_TO_M;
  if (!input.integrateCurrent || !input.currentField) {
    return [input.pos, projectGreatCircle(input.pos, input.headingRad, totalM)];
  }
  const segCount = Math.min(
    MAX_SEGMENTS,
    Math.max(1, Math.ceil(input.distanceNm / 0.25)), // ~0.25 NM segments preferred
  );
  const segM = totalM / segCount;
  // Time per segment: time = distance / speed (in seconds)
  const segS = segM / input.throughWaterSpeedMs;
  // Convert timeAtSampleMs (epoch ms) to unix seconds for interpolateCurrent
  const tS = input.timeAtSampleMs / 1000;
  const field = input.currentField;
  const latMin = field.lats[0]!;
  const latMax = field.lats[field.lats.length - 1]!;
  const lonMin = field.lons[0]!;
  const lonMax = field.lons[field.lons.length - 1]!;
  const timeMin = field.times[0]!;
  const timeMax = field.times[field.times.length - 1]!;
  const tClamped = Math.max(timeMin, Math.min(timeMax, tS));

  const out: LatLon[] = [input.pos];
  let cursor = input.pos;
  for (let i = 0; i < segCount; i++) {
    // Sample current at the midpoint of the through-water-only projection.
    const midpoint = projectGreatCircle(cursor, input.headingRad, segM / 2);
    // Clamp sample point to field bounds — outside the field, treat current as zero.
    const sampleLat = Math.max(latMin, Math.min(latMax, midpoint.lat));
    const sampleLon = Math.max(lonMin, Math.min(lonMax, midpoint.lon));
    const curr = interpolateCurrent(field, sampleLat, sampleLon, tClamped);
    // Through-water end for this segment.
    const twEnd = projectGreatCircle(cursor, input.headingRad, segM);
    // Add current displacement: u m/s east, v m/s north, over segS seconds.
    const currEastM = curr.u * segS;
    const currNorthM = curr.v * segS;
    // Apply current displacement as an additional bearing+distance step from twEnd.
    const currDistM = Math.hypot(currEastM, currNorthM);
    if (currDistM > 1e-3) {
      // bearing: east = π/2, north = 0
      const currBearingRad = Math.atan2(currEastM, currNorthM);
      cursor = projectGreatCircle(twEnd, currBearingRad, currDistM);
    } else {
      cursor = twEnd;
    }
    out.push(cursor);
  }
  return out;
}
