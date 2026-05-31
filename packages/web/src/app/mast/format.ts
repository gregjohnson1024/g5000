import type { JsonSafeSample } from '@g5000/core';
import type { DisplayUnit, MastThreshold, MastTile } from '@g5000/mast';
import { MS_TO_KN, RAD_TO_DEG, wrap360 } from '../../lib/units.js';
import { STALE_THRESHOLD_MS } from '../sensors/freshness.js';

export const M_TO_FT = 3.280839895;

export type TileColor = 'green' | 'amber' | 'red' | 'default';

export interface FormattedTile {
  text: string;
  stale: boolean;
  color: TileColor;
}

function scalarValue(sample: JsonSafeSample | undefined): number | null {
  if (!sample || sample.value.kind !== 'scalar') return null;
  return sample.value.value;
}

/** Convert an SI scalar into the tile's display unit. */
function convert(si: number, units: DisplayUnit): number {
  switch (units) {
    case 'kn':
      return si * MS_TO_KN;
    case 'deg':
      return si * RAD_TO_DEG;
    case 'degT':
      return wrap360(si * RAD_TO_DEG);
    case 'ft':
      return si * M_TO_FT;
    case 'm':
    case 'pct':
    case 'v':
    case 'raw':
    default:
      return si;
  }
}

function matchThreshold(value: number, thresholds: MastThreshold[] | undefined): TileColor {
  if (!thresholds) return 'default';
  for (const t of thresholds) {
    if (t.lt !== undefined && !(value < t.lt)) continue;
    if (t.lte !== undefined && !(value <= t.lte)) continue;
    if (t.gt !== undefined && !(value > t.gt)) continue;
    if (t.gte !== undefined && !(value >= t.gte)) continue;
    return t.color;
  }
  return 'default';
}

export function formatTile(tile: MastTile, sample: JsonSafeSample | undefined, nowMs: number): FormattedTile {
  const si = scalarValue(sample);
  if (si === null || sample === undefined) return { text: '—', stale: true, color: 'default' };
  const display = convert(si, tile.units);
  const stale = nowMs - sample.t_ms > STALE_THRESHOLD_MS;
  return {
    text: display.toFixed(tile.decimals),
    stale,
    color: matchThreshold(display, tile.thresholds),
  };
}
