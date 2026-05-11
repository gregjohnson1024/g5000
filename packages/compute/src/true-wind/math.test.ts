import { describe, it, expect } from 'vitest';
import {
  computeTrueWind,
  bilinearInterpolate2D,
  applyBspCal,
  applyCompassDeviation,
  type TrueWindInputs,
} from './math.js';
import {
  DEFAULT_AWS_AWA_CAL,
  DEFAULT_BSP_CAL,
  DEFAULT_COMPASS_DEVIATION,
  DEFAULT_BOAT_CONFIG,
} from '@g5000/db';

const baseInputs = (overrides: Partial<TrueWindInputs> = {}): TrueWindInputs => ({
  aws: 5, // m/s
  awa: Math.PI / 4, // 45°
  bsp: 3, // m/s
  headingMagRad: 0,
  yawRateRad: 0,
  awsAwaCal: DEFAULT_AWS_AWA_CAL,
  bspCal: DEFAULT_BSP_CAL,
  compassDeviation: DEFAULT_COMPASS_DEVIATION,
  boatConfig: DEFAULT_BOAT_CONFIG,
  ...overrides,
});

describe('computeTrueWind — round trip', () => {
  it('produces sensible TWS/TWA when AW = vector(BSP, 0) (boat steaming straight into apparent wind)', () => {
    // Apparent wind aligned with bow at 5 m/s, boat moving forward at 3 m/s.
    // True wind should be 2 m/s, on the bow.
    const out = computeTrueWind(baseInputs({ aws: 5, awa: 0, bsp: 3 }));
    expect(out.tws).toBeCloseTo(2, 4);
    expect(out.twa).toBeCloseTo(0, 4);
  });

  it('produces a non-trivial TWS when apparent wind is on the beam at boat speed', () => {
    // AW = (0, 3) at the masthead, V = (3, 0). True wind = (-3, 3).
    // |TW| = 3*sqrt(2) ≈ 4.24
    const out = computeTrueWind(baseInputs({ aws: 3, awa: Math.PI / 2, bsp: 3 }));
    expect(out.tws).toBeCloseTo(Math.sqrt(18), 3);
  });

  it('with identity cal, produces finite TWS/TWA/TWD', () => {
    const out = computeTrueWind(baseInputs());
    expect(Number.isFinite(out.tws)).toBe(true);
    expect(Number.isFinite(out.twa)).toBe(true);
    expect(Number.isFinite(out.twd)).toBe(true);
  });

  it('TWD = TWA when heading = 0 (compass-style angles)', () => {
    const out = computeTrueWind(baseInputs({ headingMagRad: 0 }));
    // TWA can be negative; TWD is normalized to [0, 2π).
    // We check that the difference is ~0 modulo 2π.
    const diff = out.twd - out.twa;
    const norm = (diff + Math.PI * 4) % (Math.PI * 2);
    expect(Math.min(norm, Math.PI * 2 - norm)).toBeLessThan(1e-6);
  });

  it('rotating heading by 90° rotates TWD by 90° (modulo 2π)', () => {
    const a = computeTrueWind(baseInputs({ headingMagRad: 0 }));
    const b = computeTrueWind(baseInputs({ headingMagRad: Math.PI / 2 }));
    let delta = b.twd - a.twd;
    // Normalize delta into [-π, π]
    while (delta > Math.PI) delta -= 2 * Math.PI;
    while (delta <= -Math.PI) delta += 2 * Math.PI;
    expect(Math.abs(delta - Math.PI / 2)).toBeLessThan(1e-6);
  });
});

describe('bilinearInterpolate2D', () => {
  it('returns the cell value at exact bin centers', () => {
    const xBins = [0, 1, 2];
    const yBins = [0, 1, 2];
    const grid = [
      [0, 1, 2],
      [3, 4, 5],
      [6, 7, 8],
    ];
    expect(bilinearInterpolate2D(xBins, yBins, grid, 1, 1)).toBe(4);
    expect(bilinearInterpolate2D(xBins, yBins, grid, 0, 0)).toBe(0);
    expect(bilinearInterpolate2D(xBins, yBins, grid, 2, 2)).toBe(8);
  });

  it('interpolates linearly between adjacent cells', () => {
    const xBins = [0, 2];
    const yBins = [0, 2];
    const grid = [
      [0, 10],
      [10, 20],
    ];
    // Halfway in both dims should be the average of all 4 corners = 10.
    expect(bilinearInterpolate2D(xBins, yBins, grid, 1, 1)).toBe(10);
  });

  it('clamps inputs outside the grid range', () => {
    const xBins = [0, 1, 2];
    const yBins = [0, 1, 2];
    const grid = [
      [0, 1, 2],
      [3, 4, 5],
      [6, 7, 8],
    ];
    expect(bilinearInterpolate2D(xBins, yBins, grid, -5, -5)).toBe(0);
    expect(bilinearInterpolate2D(xBins, yBins, grid, 99, 99)).toBe(8);
  });
});

describe('applyBspCal', () => {
  it('returns BSP unchanged with identity multiplier', () => {
    expect(applyBspCal(5, DEFAULT_BSP_CAL)).toBe(5);
  });

  it('applies linearly-interpolated multiplier', () => {
    const cal = {
      bins: [0, 10],
      multiplier: [0.9, 1.1], // halfway → 1.0
    };
    // At bsp = 5 (halfway), multiplier should be 1.0 → output = 5.
    expect(applyBspCal(5, cal)).toBeCloseTo(5, 6);
  });
});

describe('applyCompassDeviation', () => {
  it('returns heading unchanged with identity deviation', () => {
    expect(applyCompassDeviation(1.234, DEFAULT_COMPASS_DEVIATION)).toBe(1.234);
  });

  it('adds the deviation for the corresponding 10° bin', () => {
    const cal = {
      deviation: Array.from({ length: 36 }, (_, i) => (i === 5 ? 0.1 : 0)),
    };
    // 5th bin = 50°-60° heading. 55° in radians is between 50° and 60°.
    const heading = (55 * Math.PI) / 180;
    const corrected = applyCompassDeviation(heading, cal);
    expect(corrected).toBeCloseTo(heading + 0.1, 6);
  });
});
