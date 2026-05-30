import { describe, it, expect } from 'vitest';
import { solarElevationDeg, isNight } from './sun.js';

// Newport, RI (~41.5N, 71.3W).
const LAT = 41.5;
const LON = -71.3;

describe('solarElevationDeg', () => {
  it('is high near local solar noon in summer', () => {
    // ~17:00 UTC ≈ local noon at 71W in June. Sun should be well above the horizon.
    const noon = new Date('2026-06-21T16:30:00Z');
    expect(solarElevationDeg(LAT, LON, noon)).toBeGreaterThan(40);
  });
  it('is well below the horizon at local midnight', () => {
    const midnight = new Date('2026-06-21T04:30:00Z');
    expect(solarElevationDeg(LAT, LON, midnight)).toBeLessThan(-10);
  });
});

describe('isNight', () => {
  it('is false at midday and true at midnight', () => {
    expect(isNight(LAT, LON, new Date('2026-06-21T16:30:00Z'))).toBe(false);
    expect(isNight(LAT, LON, new Date('2026-06-21T04:30:00Z'))).toBe(true);
  });
});
