import { describe, it, expect } from 'vitest';
import { validateMastLayout } from './validate.js';

const KNOWN = new Set(['wind.true.angle', 'wind.true.speed', 'boat.speed.water', 'nav.gps.sog']);

const goodTile = { field: 'boat.speed.water', label: 'BSP', units: 'kn', decimals: 2 };
const goodLayout = {
  version: 1,
  pages: [{ id: 'main', label: 'Main', grid: '2', condition: { always: true }, tiles: [goodTile, { ...goodTile, field: 'wind.true.speed', label: 'TWS' }] }],
};

describe('validateMastLayout', () => {
  it('accepts a well-formed layout', () => {
    const r = validateMastLayout(goodLayout, KNOWN);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.layout.pages[0]!.tiles.length).toBe(2);
  });

  it('rejects an unknown channel field', () => {
    const bad = structuredClone(goodLayout);
    bad.pages[0]!.tiles[0]!.field = 'no.such.channel';
    const r = validateMastLayout(bad, KNOWN);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.join(' ')).toContain('no.such.channel');
  });

  it('rejects more tiles than the grid capacity', () => {
    const bad = structuredClone(goodLayout);
    bad.pages[0]!.grid = '1'; // capacity 1, has 2 tiles
    const r = validateMastLayout(bad, KNOWN);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.join(' ')).toContain('capacity');
  });

  it('rejects an unknown grid kind', () => {
    const bad = structuredClone(goodLayout);
    (bad.pages[0] as { grid: string }).grid = '5';
    const r = validateMastLayout(bad, KNOWN);
    expect(r.ok).toBe(false);
  });

  it('rejects duplicate page ids', () => {
    const bad = structuredClone(goodLayout);
    bad.pages.push(structuredClone(bad.pages[0]!));
    const r = validateMastLayout(bad, KNOWN);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.join(' ')).toContain('duplicate');
  });

  it('rejects a non-object input', () => {
    expect(validateMastLayout(null, KNOWN).ok).toBe(false);
    expect(validateMastLayout('x', KNOWN).ok).toBe(false);
  });
});
