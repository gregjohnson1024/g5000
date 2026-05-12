import { describe, it, expect, beforeAll } from 'vitest';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadCoastlineFromGeojson } from './load.js';
import { isOnLand, intersectsLand } from './queries.js';
import type { Coastline } from './types.js';

const here = dirname(fileURLToPath(import.meta.url));
const FIXTURE = resolve(here, '../test/fixtures/bahamas-l.geojson');
let c: Coastline;

beforeAll(async () => { c = await loadCoastlineFromGeojson(FIXTURE, 'l'); });

describe('isOnLand', () => {
  it('detects a point inside the big island', () => {
    expect(isOnLand(c, 24.5, -76.5)).toBe(true);
  });
  it('detects a point in open water', () => {
    expect(isOnLand(c, 26, -75)).toBe(false);
  });
});

describe('intersectsLand', () => {
  it('detects a segment that crosses an island', () => {
    expect(intersectsLand(c, 24.5, -77.5, 24.5, -75.5)).toBe(true);
  });
  it('returns false for a segment entirely in water', () => {
    expect(intersectsLand(c, 22, -80, 22, -70)).toBe(false);
  });
  it('returns true if endpoint sits in the polygon', () => {
    expect(intersectsLand(c, 24.5, -76.5, 24.5, -75)).toBe(true);
  });
});
