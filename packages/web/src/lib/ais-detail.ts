import type { AisTarget } from '@g5000/core';
import type { CpaResult } from '@g5000/compute';

const MS_TO_KN = 1 / 0.514444;
const RAD_TO_DEG = 180 / Math.PI;
const NM = 1852;

/** TCPA as `m:ss`; "past" once the closest approach is behind us; "—" if unknown. */
export function fmtTcpa(seconds: number): string {
  if (!Number.isFinite(seconds)) return '—';
  if (seconds < 0) return 'past';
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}:${String(secs).padStart(2, '0')}`;
}

/**
 * Label/value rows describing an AIS target — the single source of truth for
 * both the /ais "Selected" panel and the chart's click popup, so the two can't
 * drift. Range/CPA/TCPA come from a precomputed CpaResult (null when there's no
 * own-boat fix or the target lacks a position), shown as "—".
 */
export function aisDetailRows(
  target: AisTarget,
  cpa: CpaResult | null,
): Array<[label: string, value: string]> {
  return [
    ['MMSI', String(target.mmsi)],
    ['Name', target.name ?? '—'],
    ['Class', target.vesselClass],
    [
      'COG',
      target.cog !== undefined ? `${((target.cog * RAD_TO_DEG + 360) % 360).toFixed(0)}°` : '—',
    ],
    ['SOG', target.sog !== undefined ? `${(target.sog * MS_TO_KN).toFixed(1)} kn` : '—'],
    ['Range', cpa ? `${(cpa.rangeMeters / NM).toFixed(2)} NM` : '—'],
    ['CPA', cpa ? `${(cpa.cpaMeters / NM).toFixed(2)} NM` : '—'],
    ['TCPA', cpa ? fmtTcpa(cpa.tcpaSeconds) : '—'],
  ];
}
