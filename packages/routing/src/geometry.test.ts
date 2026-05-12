import { describe, it, expect } from 'vitest';
import {
  greatCircleBearing,
  greatCircleDistance,
  rhumbStep,
  normalizeAngle,
  normalizeBearing,
} from './geometry.js';

const NEWPORT = { lat: 41.49, lon: -71.31 };
const BERMUDA = { lat: 32.30, lon: -64.78 };

describe('normalizeAngle', () => {
  it('wraps into [-π, π]', () => {
    expect(normalizeAngle(Math.PI * 3)).toBeCloseTo(Math.PI, 6);
    expect(normalizeAngle(-Math.PI * 3)).toBeCloseTo(-Math.PI, 6);
    expect(normalizeAngle(0)).toBeCloseTo(0, 6);
  });
});

describe('normalizeBearing', () => {
  it('wraps into [0, 2π)', () => {
    expect(normalizeBearing(2.5 * Math.PI)).toBeCloseTo(0.5 * Math.PI, 6);
    expect(normalizeBearing(-0.5 * Math.PI)).toBeCloseTo(1.5 * Math.PI, 6);
  });
});

describe('greatCircleDistance', () => {
  it('Newport→Bermuda is ~635 NM ± 5 NM', () => {
    const d = greatCircleDistance(NEWPORT, BERMUDA);
    const nm = d / 1852;
    expect(nm).toBeGreaterThan(630);
    expect(nm).toBeLessThan(640);
  });
  it('symmetric', () => {
    expect(greatCircleDistance(NEWPORT, BERMUDA)).toBeCloseTo(
      greatCircleDistance(BERMUDA, NEWPORT),
      0,
    );
  });
});

describe('greatCircleBearing', () => {
  it('Newport→Bermuda points roughly south (≈ 5π/3 = 300°… no, ~165°… verify)', () => {
    // Bearing from Newport (41.5N -71.3W) to Bermuda (32.3N -64.8W) is ~155° true.
    const b = greatCircleBearing(NEWPORT, BERMUDA);
    const deg = (b * 180) / Math.PI;
    expect(deg).toBeGreaterThan(140);
    expect(deg).toBeLessThan(170);
  });
});

describe('rhumbStep', () => {
  it('moves due north when bearing=0', () => {
    const p = rhumbStep({ lat: 0, lon: 0 }, 111195, 0); // 1° at the equator
    expect(p.lat).toBeCloseTo(1, 4);
    expect(p.lon).toBeCloseTo(0, 4);
  });
  it('moves due east at the equator when bearing=π/2', () => {
    const p = rhumbStep({ lat: 0, lon: 0 }, 111195, Math.PI / 2);
    expect(p.lat).toBeCloseTo(0, 4);
    expect(p.lon).toBeCloseTo(1, 4);
  });
});
