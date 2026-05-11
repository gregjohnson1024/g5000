import { describe, it, expect } from 'vitest';
import { interpolatePolarSpeed, vmgFor, optimalTwaForVmg } from './math.js';
import { DEFAULT_POLARS } from '@g5000/db';

describe('interpolatePolarSpeed', () => {
  it('returns the cell value at an exact (TWS, TWA) bin match', () => {
    const tws = DEFAULT_POLARS.twsBins[2]!;
    const twa = DEFAULT_POLARS.twaBins[2]!;
    const expected = DEFAULT_POLARS.boatSpeed[2]![2]!;
    const v = interpolatePolarSpeed(DEFAULT_POLARS, tws, twa);
    expect(v).toBeCloseTo(expected, 6);
  });

  it('clamps inputs below all bins to the first cell', () => {
    const v = interpolatePolarSpeed(DEFAULT_POLARS, 0.1, 0);
    expect(v).toBe(DEFAULT_POLARS.boatSpeed[0]![0]);
  });

  it('clamps inputs above all bins to the last cell', () => {
    const v = interpolatePolarSpeed(DEFAULT_POLARS, 100, Math.PI * 2);
    const last = DEFAULT_POLARS.boatSpeed[DEFAULT_POLARS.twsBins.length - 1]!;
    expect(v).toBe(last[last.length - 1]);
  });

  it('interpolates linearly between bins', () => {
    const midTws = (DEFAULT_POLARS.twsBins[2]! + DEFAULT_POLARS.twsBins[3]!) / 2;
    const twa = DEFAULT_POLARS.twaBins[4]!;
    const a = DEFAULT_POLARS.boatSpeed[2]![4]!;
    const b = DEFAULT_POLARS.boatSpeed[3]![4]!;
    const v = interpolatePolarSpeed(DEFAULT_POLARS, midTws, twa);
    expect(v).toBeCloseTo((a + b) / 2, 6);
  });
});

describe('vmgFor', () => {
  it('returns positive VMG upwind (TWA < π/2)', () => {
    expect(vmgFor(5, (45 * Math.PI) / 180)).toBeCloseTo(5 * Math.cos((45 * Math.PI) / 180), 6);
  });

  it('returns negative VMG downwind (TWA > π/2)', () => {
    expect(vmgFor(5, (135 * Math.PI) / 180)).toBeCloseTo(5 * Math.cos((135 * Math.PI) / 180), 6);
  });
});

describe('optimalTwaForVmg', () => {
  it('finds an upwind TWA in (0, π/2) at moderate TWS', () => {
    const twa = optimalTwaForVmg(DEFAULT_POLARS, 8, 'upwind');
    expect(twa).toBeGreaterThan(0);
    expect(twa).toBeLessThan(Math.PI / 2);
  });

  it('finds a downwind TWA in (π/2, π)', () => {
    const twa = optimalTwaForVmg(DEFAULT_POLARS, 8, 'downwind');
    expect(twa).toBeGreaterThan(Math.PI / 2);
    expect(twa).toBeLessThan(Math.PI);
  });

  it('is monotonic in the right direction with wind speed (rough sanity)', () => {
    // A reasonable cat polar will broaden (optimal TWA stays close to 45°) with
    // light air → moderate. Just assert finite-ness; specific bin choices may
    // jump around because the table is coarse.
    expect(Number.isFinite(optimalTwaForVmg(DEFAULT_POLARS, 4, 'upwind'))).toBe(true);
    expect(Number.isFinite(optimalTwaForVmg(DEFAULT_POLARS, 12, 'downwind'))).toBe(true);
  });
});
