import { describe, it, expect } from 'vitest';
import { interpolateWind, interpolateCurrent } from './interpolate.js';
import type { WindField, CurrentField } from './types.js';

const FIELD: WindField = {
  lats: [30, 31],
  lons: [-75, -74],
  times: [1000, 2000],
  u: [
    [
      [5, 7],
      [9, 11],
    ], // t=1000, [lat][lon]
    [
      [15, 17],
      [19, 21],
    ], // t=2000
  ],
  v: [
    [
      [2, 4],
      [6, 8],
    ],
    [
      [12, 14],
      [16, 18],
    ],
  ],
  source: 'GFS',
  runTime: 1000,
};

describe('interpolateWind', () => {
  it('returns exact grid value at corner', () => {
    const out = interpolateWind(FIELD, 30, -75, 1000);
    expect(out.u).toBeCloseTo(5, 6);
    expect(out.v).toBeCloseTo(2, 6);
  });

  it('linearly interpolates along lon at corner lat/time', () => {
    const out = interpolateWind(FIELD, 30, -74.5, 1000);
    expect(out.u).toBeCloseTo(6, 6); // midway between 5 and 7
    expect(out.v).toBeCloseTo(3, 6);
  });

  it('bilinearly interpolates in space at a corner time', () => {
    const out = interpolateWind(FIELD, 30.5, -74.5, 1000);
    // Cell corners: (5,7,9,11) → center = 8
    expect(out.u).toBeCloseTo(8, 6);
    expect(out.v).toBeCloseTo(5, 6); // (2+4+6+8)/4
  });

  it('trilinearly interpolates with a time offset', () => {
    const out = interpolateWind(FIELD, 30.5, -74.5, 1500);
    // t=1000 center = 8, t=2000 center = 18 → t=1500 → 13
    expect(out.u).toBeCloseTo(13, 6);
    expect(out.v).toBeCloseTo(10, 6); // (5+15)/2
  });

  it('throws when point is outside the grid (no silent extrapolation)', () => {
    expect(() => interpolateWind(FIELD, 29.9, -75, 1000)).toThrow(/out of range|outside/i);
    expect(() => interpolateWind(FIELD, 30, -75, 500)).toThrow(/out of range|outside/i);
  });
});

describe('interpolateCurrent', () => {
  it('reuses the same interpolation against a CurrentField', () => {
    const cf: CurrentField = { ...FIELD, source: 'RTOFS' };
    const out = interpolateCurrent(cf, 30, -75, 1000);
    expect(out.u).toBeCloseTo(5, 6);
    expect(out.v).toBeCloseTo(2, 6);
  });
});
