import { describe, it, expect } from 'vitest';
import { computeCpa } from './cpa.js';

const KN = 0.514444;
const NM_TO_M = 1852;

describe('computeCpa', () => {
  it('head-on collision: 1 NM apart, both 10 kn straight at each other → tcpa ≈ 180s, cpa ≈ 0', () => {
    const own = { lat: 0, lon: 0, cog: 0, sog: 10 * KN }; // heading N
    // Target 1 NM north, heading S at 10 kn.
    const target = {
      lat: 1 / 60, // 1 NM ≈ 1/60 degree latitude
      lon: 0,
      cog: Math.PI, // heading S
      sog: 10 * KN,
    };
    const r = computeCpa(own, target);
    expect(r.rangeMeters).toBeCloseTo(NM_TO_M, -1); // 1 NM
    expect(r.tcpaSeconds).toBeCloseTo(180, 0); // closing at 20 kn ≈ 1 NM in 3 min
    expect(r.cpaMeters).toBeLessThan(10); // basically zero
    expect(r.bearingRadians).toBeCloseTo(0, 2); // due north
  });

  it('parallel courses: same speed same heading → never converges, cpa = current range', () => {
    const own = { lat: 0, lon: 0, cog: 0, sog: 5 * KN };
    const target = { lat: 0, lon: 0.01, cog: 0, sog: 5 * KN };
    const r = computeCpa(own, target);
    expect(r.cpaMeters).toBeCloseTo(r.rangeMeters, 0); // doesn't get closer
    expect(Math.abs(r.tcpaSeconds)).toBeLessThan(1); // tcpa ≈ 0 (no relative motion)
  });

  it('diverging: own going N, target going S behind, tcpa negative', () => {
    const own = { lat: 0, lon: 0, cog: 0, sog: 5 * KN };
    const target = { lat: -1 / 60, lon: 0, cog: Math.PI, sog: 5 * KN };
    const r = computeCpa(own, target);
    expect(r.tcpaSeconds).toBeLessThan(0);
  });

  it('handles zero relative motion (same vel) without dividing by zero', () => {
    const own = { lat: 45, lon: -75, cog: Math.PI / 4, sog: 7 };
    const target = { lat: 45.01, lon: -74.99, cog: Math.PI / 4, sog: 7 };
    const r = computeCpa(own, target);
    expect(Number.isFinite(r.cpaMeters)).toBe(true);
    expect(Number.isFinite(r.tcpaSeconds)).toBe(true);
    // tcpa is exactly 0 in the zero-rel-motion case; cpa = current range.
    expect(r.tcpaSeconds).toBe(0);
    expect(r.cpaMeters).toBeCloseTo(r.rangeMeters);
  });

  it('bearing: target due east → bearing ≈ π/2', () => {
    const own = { lat: 0, lon: 0, cog: 0, sog: 0 };
    const target = { lat: 0, lon: 0.01, cog: 0, sog: 0 };
    const r = computeCpa(own, target);
    expect(r.bearingRadians).toBeCloseTo(Math.PI / 2, 1);
  });

  it('bearing: target due south → bearing ≈ π', () => {
    const own = { lat: 0, lon: 0, cog: 0, sog: 0 };
    const target = { lat: -0.01, lon: 0, cog: 0, sog: 0 };
    const r = computeCpa(own, target);
    expect(r.bearingRadians).toBeCloseTo(Math.PI, 1);
  });

  it('bearing wraps into [0, 2π) for targets west of own', () => {
    const own = { lat: 0, lon: 0, cog: 0, sog: 0 };
    const target = { lat: 0, lon: -0.01, cog: 0, sog: 0 };
    const r = computeCpa(own, target);
    expect(r.bearingRadians).toBeCloseTo((3 * Math.PI) / 2, 1);
  });

  it('crossing 90° — own going N, target going E from west, CPA equals north-offset distance', () => {
    // Own at (0,0) going N at 5 kn. Target 1 NM west, 1 NM north, going E at 5 kn.
    // After tcpa seconds the target will arrive at own's longitude; cpa is the
    // distance own has moved north minus the target's latitude offset.
    const own = { lat: 0, lon: 0, cog: 0, sog: 5 * KN };
    const target = {
      lat: 1 / 60,
      lon: -1 / 60,
      cog: Math.PI / 2, // heading E
      sog: 5 * KN,
    };
    const r = computeCpa(own, target);
    // tcpa should be positive (closing)
    expect(r.tcpaSeconds).toBeGreaterThan(0);
    // CPA should be much less than current range (1.41 NM)
    expect(r.cpaMeters).toBeLessThan(r.rangeMeters);
    expect(r.cpaMeters).toBeGreaterThanOrEqual(0);
  });

  it('exposes cpaRelativeEast/North for chart-marker rendering', () => {
    // Target 1 NM north, heading SW at 5 kn. Own stationary.
    const target = {
      lat: 1 / 60,
      lon: 0,
      cog: (5 * Math.PI) / 4, // SW
      sog: 5 * KN,
    };
    const own = { lat: 0, lon: 0, cog: 0, sog: 0 };
    const r = computeCpa(own, target);
    // cpaRelativeEast/North should sit on the target's projected line — i.e.
    // sqrt(east² + north²) must equal cpaMeters by construction.
    const recomputed = Math.hypot(r.cpaRelativeEast, r.cpaRelativeNorth);
    expect(recomputed).toBeCloseTo(r.cpaMeters, 5);
    // For this geometry (target starts 1 NM N of own, heads SW), the CPA
    // point ends up to the NORTHWEST: target moves SW just long enough to
    // cancel half its northward offset, leaving NW.
    expect(r.cpaRelativeEast).toBeLessThan(0);
    expect(r.cpaRelativeNorth).toBeGreaterThan(0);
  });

  it('cpaRelativeEast/North = current relative position when tcpa = 0', () => {
    // Identical velocities → zero relative motion → tcpa = 0, CPA marker at
    // the target's current position.
    const own = { lat: 0, lon: 0, cog: Math.PI / 2, sog: 5 * KN };
    const target = { lat: 0, lon: 1 / 60, cog: Math.PI / 2, sog: 5 * KN };
    const r = computeCpa(own, target);
    expect(Math.abs(r.tcpaSeconds)).toBeLessThan(1);
    // Target is east of own; cpaRelativeEast > 0, cpaRelativeNorth ≈ 0.
    expect(r.cpaRelativeEast).toBeGreaterThan(0);
    expect(Math.abs(r.cpaRelativeNorth)).toBeLessThan(10);
  });
});
