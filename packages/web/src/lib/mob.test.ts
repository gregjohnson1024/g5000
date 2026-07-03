import { describe, expect, it } from 'vitest';
import { haversineM, initialBearingDeg } from './mob';

// One degree of arc on a sphere of R = 6_371_000 m.
const ONE_DEG_M = (2 * Math.PI * 6_371_000) / 360; // ≈ 111_194.9 m

describe('haversineM', () => {
  it('returns 0 for coincident points', () => {
    const p = { lat: 41.765, lon: -71.128 };
    expect(haversineM(p, p)).toBe(0);
  });

  it('measures one degree of latitude as ~111.2 km', () => {
    const d = haversineM({ lat: 0, lon: 0 }, { lat: 1, lon: 0 });
    expect(d).toBeCloseTo(ONE_DEG_M, -1); // within 5 m
  });

  it('measures one degree of longitude at the equator as ~111.2 km', () => {
    const d = haversineM({ lat: 0, lon: 0 }, { lat: 0, lon: 1 });
    expect(d).toBeCloseTo(ONE_DEG_M, -1);
  });

  it('shrinks a degree of longitude by cos(lat) away from the equator', () => {
    const d = haversineM({ lat: 50, lon: 0 }, { lat: 50, lon: 1 });
    expect(d).toBeCloseTo(ONE_DEG_M * Math.cos((50 * Math.PI) / 180), -2); // within 50 m
  });

  it('is symmetric', () => {
    const a = { lat: 32.29, lon: -64.79 }; // Bermuda
    const b = { lat: 41.49, lon: -71.31 }; // Newport
    expect(haversineM(a, b)).toBeCloseTo(haversineM(b, a), 6);
  });
});

describe('initialBearingDeg', () => {
  const origin = { lat: 0, lon: 0 };

  it('points due north / east / south / west along the axes', () => {
    expect(initialBearingDeg(origin, { lat: 1, lon: 0 })).toBeCloseTo(0, 6);
    expect(initialBearingDeg(origin, { lat: 0, lon: 1 })).toBeCloseTo(90, 6);
    expect(initialBearingDeg(origin, { lat: -1, lon: 0 })).toBeCloseTo(180, 6);
    expect(initialBearingDeg(origin, { lat: 0, lon: -1 })).toBeCloseTo(270, 6);
  });

  it('gives just under 45° for an equal lat/lon step from the equator', () => {
    // Great-circle initial bearing to (1,1) is slightly less than the rhumb 45°.
    const b = initialBearingDeg(origin, { lat: 1, lon: 1 });
    expect(b).toBeGreaterThan(44.9);
    expect(b).toBeLessThan(45);
  });

  it('stays in [0, 360)', () => {
    const b = initialBearingDeg({ lat: 41.49, lon: -71.31 }, { lat: 32.29, lon: -64.79 });
    expect(b).toBeGreaterThanOrEqual(0);
    expect(b).toBeLessThan(360);
    // Newport → Bermuda is broadly south-east.
    expect(b).toBeGreaterThan(120);
    expect(b).toBeLessThan(180);
  });
});
