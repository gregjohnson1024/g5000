import { Channels } from '@g5000/core';
import { GRID_CAPACITY, type GridKind, type MastLayout, type MastTile } from './types.js';

const DISPLAY_UNITS = new Set(['kn', 'deg', 'degT', 'm', 'ft', 'pct', 'v', 'raw']);
const THRESHOLD_COLORS = new Set(['green', 'amber', 'red', 'default']);

export type ValidateResult =
  | { ok: true; layout: MastLayout }
  | { ok: false; errors: string[] };

/** Collect all string leaves of the Channels registry into a Set of channel names. */
export function knownChannelSet(): ReadonlySet<string> {
  const out = new Set<string>();
  const walk = (v: unknown): void => {
    if (typeof v === 'string') out.add(v);
    else if (v && typeof v === 'object') for (const x of Object.values(v)) walk(x);
  };
  walk(Channels);
  return out;
}

function isGridKind(g: unknown): g is GridKind {
  return typeof g === 'string' && g in GRID_CAPACITY;
}

function validateTile(t: unknown, known: ReadonlySet<string>, where: string, errors: string[]): void {
  if (!t || typeof t !== 'object') {
    errors.push(`${where}: tile is not an object`);
    return;
  }
  const tile = t as Partial<MastTile>;
  if (typeof tile.field !== 'string' || !known.has(tile.field)) {
    errors.push(`${where}: unknown channel "${String(tile.field)}"`);
  }
  if (typeof tile.label !== 'string' || tile.label.length === 0) errors.push(`${where}: label must be a non-empty string`);
  if (typeof tile.units !== 'string' || !DISPLAY_UNITS.has(tile.units)) errors.push(`${where}: invalid units "${String(tile.units)}"`);
  if (typeof tile.decimals !== 'number' || !Number.isInteger(tile.decimals) || tile.decimals < 0 || tile.decimals > 3) {
    errors.push(`${where}: decimals must be an integer 0..3`);
  }
  if (tile.thresholds !== undefined) {
    if (!Array.isArray(tile.thresholds)) errors.push(`${where}: thresholds must be an array`);
    else tile.thresholds.forEach((th, i) => {
      if (!th || typeof th !== 'object' || !THRESHOLD_COLORS.has((th as { color?: unknown }).color as string)) {
        errors.push(`${where}: threshold[${i}] needs a valid color`);
      }
    });
  }
}

export function validateMastLayout(input: unknown, known: ReadonlySet<string>): ValidateResult {
  const errors: string[] = [];
  if (!input || typeof input !== 'object') return { ok: false, errors: ['layout is not an object'] };
  const layout = input as Partial<MastLayout>;
  if (layout.version !== 1) errors.push('version must be 1');
  if (!Array.isArray(layout.pages) || layout.pages.length === 0) {
    return { ok: false, errors: [...errors, 'pages must be a non-empty array'] };
  }
  const ids = new Set<string>();
  layout.pages.forEach((p, pi) => {
    const where = `pages[${pi}]`;
    if (!p || typeof p !== 'object') {
      errors.push(`${where}: page is not an object`);
      return;
    }
    if (typeof p.id !== 'string' || p.id.length === 0) errors.push(`${where}: id must be a non-empty string`);
    else if (ids.has(p.id)) errors.push(`${where}: duplicate page id "${p.id}"`);
    else ids.add(p.id);
    if (typeof p.label !== 'string' || p.label.length === 0) errors.push(`${where}: label must be a non-empty string`);
    if (!isGridKind(p.grid)) errors.push(`${where}: invalid grid "${String(p.grid)}"`);
    if (p.condition !== undefined) {
      const c = p.condition as Record<string, unknown>;
      const okCond = ('always' in c && c.always === true) || (typeof c.mode === 'string');
      if (!okCond) errors.push(`${where}: condition must be {mode} or {always:true}`);
    }
    if (!Array.isArray(p.tiles) || p.tiles.length === 0) {
      errors.push(`${where}: tiles must be a non-empty array`);
    } else {
      if (isGridKind(p.grid) && p.tiles.length > GRID_CAPACITY[p.grid]) {
        errors.push(`${where}: ${p.tiles.length} tiles exceed grid "${p.grid}" capacity ${GRID_CAPACITY[p.grid]}`);
      }
      p.tiles.forEach((t, ti) => validateTile(t, known, `${where}.tiles[${ti}]`, errors));
    }
  });
  return errors.length === 0 ? { ok: true, layout: input as MastLayout } : { ok: false, errors };
}
