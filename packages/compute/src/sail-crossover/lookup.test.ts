import { describe, it, expect } from 'vitest';
import type { PolarTable, CrossoverMap } from '@g5000/db';
import { snapToCell, lookupConfigId } from './lookup.js';

const PI = Math.PI;

const polar: PolarTable = {
  twsBins: [3.09, 4.12, 5.14, 6.17, 7.20, 8.23, 10.29, 12.86], // 6,8,10,12,14,16,20,25 kn → m/s
  twaBins: [0, PI / 6, PI / 4, PI / 3, PI / 2, (2 * PI) / 3, (3 * PI) / 4, (5 * PI) / 6, PI],
  boatSpeed: Array.from({ length: 8 }, () => Array.from({ length: 9 }, () => 0)),
};

const map: CrossoverMap = {
  boatId: 'sula',
  mode: 'default',
  cells: {
    '0,3': 'a-sail',
    '4,5': 'b-sail',
    '7,8': 'c-sail',
  },
  updatedAt: 0,
};

describe('snapToCell', () => {
  it('snaps an exact bin centre to that cell', () => {
    expect(snapToCell(polar, 7.20, PI / 2)).toEqual({ twsIdx: 4, twaIdx: 4 });
  });

  it('snaps nearest by absolute distance', () => {
    // TWS halfway between bin 0 (6 kn) and bin 1 (8 kn) — 7 kn → bin closer is bin 0
    expect(snapToCell(polar, 6.5 * 0.514444, 0)).toMatchObject({ twsIdx: 0 });
  });

  it('clamps below the min TWS bin to 0', () => {
    expect(snapToCell(polar, 1.0, 0)).toMatchObject({ twsIdx: 0 });
  });

  it('clamps above the max TWS bin to last', () => {
    expect(snapToCell(polar, 50.0, 0)).toMatchObject({ twsIdx: 7 });
  });

  it('folds negative TWA into [0, π]', () => {
    expect(snapToCell(polar, 7.20, -PI / 4)).toEqual(snapToCell(polar, 7.20, PI / 4));
  });

  it('folds TWA > π by wrapping (port/starboard symmetric)', () => {
    // (3π/2) folds to (π/2)
    expect(snapToCell(polar, 7.20, (3 * PI) / 2)).toEqual(snapToCell(polar, 7.20, PI / 2));
  });
});

describe('lookupConfigId', () => {
  it('returns the configId at a filled cell', () => {
    expect(lookupConfigId(map, polar, polar.twsBins[4]!, polar.twaBins[5]!)).toBe('b-sail');
  });

  it('returns null at an empty cell', () => {
    expect(lookupConfigId(map, polar, polar.twsBins[1]!, polar.twaBins[1]!)).toBeNull();
  });

  it('handles symmetric TWA when looking up', () => {
    expect(lookupConfigId(map, polar, polar.twsBins[4]!, -polar.twaBins[5]!)).toBe('b-sail');
  });
});
