import { describe, it, expect } from 'vitest';
import { decomposeWind, twaFromWindAndHeading } from './wind.js';

describe('decomposeWind', () => {
  it('u=10, v=0 → wind blowing east → coming from west (TWD = 3π/2)', () => {
    const w = decomposeWind(10, 0);
    expect(w.tws).toBeCloseTo(10, 6);
    expect(w.twd).toBeCloseTo((3 * Math.PI) / 2, 4);
  });
  it('u=0, v=10 → wind blowing north → coming from south (TWD = π)', () => {
    const w = decomposeWind(0, 10);
    expect(w.tws).toBeCloseTo(10, 6);
    expect(w.twd).toBeCloseTo(Math.PI, 4);
  });
  it('u=0, v=-10 → wind blowing south → from north (TWD = 0)', () => {
    const w = decomposeWind(0, -10);
    expect(w.twd).toBeCloseTo(0, 4);
  });
});

describe('twaFromWindAndHeading', () => {
  it('boat heading north, wind from north → TWA = 0', () => {
    const twa = twaFromWindAndHeading(0, 0);
    expect(twa).toBeCloseTo(0, 6);
  });
  it('boat heading east, wind from north → TWA = -π/2 (wind on port bow)', () => {
    const twa = twaFromWindAndHeading(0, Math.PI / 2);
    expect(Math.abs(twa)).toBeCloseTo(Math.PI / 2, 4);
  });
});
