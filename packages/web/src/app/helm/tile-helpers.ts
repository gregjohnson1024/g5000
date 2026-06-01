import type { JsonSafeSample } from '@g5000/core';
import { MS_TO_KN, RAD_TO_DEG, wrap360 } from '../../lib/units';
import { fmtLatDmm, fmtLonDmm } from '../../lib/format-coords';

export function scalar(s: JsonSafeSample | undefined): number | null {
  if (!s || s.value.kind !== 'scalar') return null;
  return s.value.value;
}

export function enumVal(s: JsonSafeSample | undefined): string | null {
  if (!s || s.value.kind !== 'enum') return null;
  return s.value.value;
}

export function geo(s: JsonSafeSample | undefined): { lat: number; lon: number } | null {
  if (!s || s.value.kind !== 'geo') return null;
  return s.value.value;
}

export function fmtSpeed(s: JsonSafeSample | undefined): string {
  const v = scalar(s);
  return v === null ? '—' : `${(v * MS_TO_KN).toFixed(1)}`;
}

export function fmtAngleSigned(s: JsonSafeSample | undefined): string {
  const v = scalar(s);
  if (v === null) return '—';
  const deg = v * RAD_TO_DEG;
  const sign = deg >= 0 ? '+' : '';
  return `${sign}${deg.toFixed(0)}`;
}

export function fmtHeading(s: JsonSafeSample | undefined): string {
  return fmtHeadingRad(scalar(s));
}

export function fmtHeadingRad(v: number | null): string {
  if (v === null) return '—';
  return `${wrap360(v * RAD_TO_DEG).toFixed(0)}`;
}

export function fmtLat(lat: number): string {
  const { deg, min, hemi } = fmtLatDmm(lat);
  return `${deg} ${min}${hemi.toLowerCase()}`;
}

export function fmtLon(lon: number): string {
  const { deg, min, hemi } = fmtLonDmm(lon);
  return `${deg} ${min}${hemi.toLowerCase()}`;
}
