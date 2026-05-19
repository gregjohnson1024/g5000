import { describe, expect, it } from 'vitest';
import type { Sail } from '@g5000/db';
import { findValidSailsByCategory } from './region-lookup.js';

const j0: Sail = {
  id: 'j0',
  name: 'J0',
  category: 'headsail',
  areaSqM: 79,
  region: { cells: ['10,12', '14,9'] },
};
const stj: Sail = {
  id: 'stj',
  name: 'STJ',
  category: 'headsail',
  areaSqM: 44,
  region: { cells: ['14,9', '20,9'] },
};
const reef1: Sail = {
  id: 'reef1',
  name: 'Reef 1',
  category: 'main',
  areaSqM: 58,
  region: { cells: ['14,9'] },
};
const g0: Sail = {
  id: 'g0',
  name: 'G0',
  category: 'downwind',
  areaSqM: 143,
  region: { cells: ['14,30'] },
};

describe('findValidSailsByCategory', () => {
  it('returns sails whose region contains the cell', () => {
    const r = findValidSailsByCategory([j0, stj, reef1, g0], { twsIdx: 14, twaIdx: 9 });
    expect(r.headsail).toEqual(['j0', 'stj']); // sorted by area desc (79 > 44)
    expect(r.main).toEqual(['reef1']);
    expect(r.downwind).toEqual([]);
  });

  it('returns empty arrays when no sail matches', () => {
    const r = findValidSailsByCategory([j0, stj, reef1, g0], { twsIdx: 0, twaIdx: 0 });
    expect(r).toEqual({ headsail: [], main: [], downwind: [] });
  });

  it('sorts sails without areaSqM last, then by id ascending', () => {
    const a: Sail = { id: 'z', name: 'Z', category: 'headsail', region: { cells: ['10,0'] } };
    const b: Sail = { id: 'a', name: 'A', category: 'headsail', region: { cells: ['10,0'] } };
    const c: Sail = {
      id: 'c',
      name: 'C',
      category: 'headsail',
      areaSqM: 50,
      region: { cells: ['10,0'] },
    };
    const r = findValidSailsByCategory([a, b, c], { twsIdx: 10, twaIdx: 0 });
    expect(r.headsail).toEqual(['c', 'a', 'z']);
  });
});
