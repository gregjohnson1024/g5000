import { describe, it, expect } from 'vitest';
import {
  projectPoint,
  haversineMeters,
  initialBearingDeg,
  bearingDeltaDeg,
  isBreached,
} from './anchor-geometry.js';

describe('projectPoint', () => {
  it('projects due north by the requested distance', () => {
    const p = projectPoint(32.3, -64.8, 0, 1000);
    expect(p.lon).toBeCloseTo(-64.8, 6);
    expect(haversineMeters({ lat: 32.3, lon: -64.8 }, p)).toBeCloseTo(1000, 0);
    expect(p.lat).toBeGreaterThan(32.3);
  });

  it('projects due east without changing latitude (at low distance)', () => {
    const p = projectPoint(0, 0, 90, 1000);
    expect(p.lat).toBeCloseTo(0, 6);
    expect(haversineMeters({ lat: 0, lon: 0 }, p)).toBeCloseTo(1000, 0);
    expect(p.lon).toBeGreaterThan(0);
  });

  it('round-trips: bearing/distance back to the origin match the projection', () => {
    const origin = { lat: 41.765, lon: -71.312 };
    const p = projectPoint(origin.lat, origin.lon, 237, 850);
    expect(haversineMeters(origin, p)).toBeCloseTo(850, 0);
    expect(initialBearingDeg(origin, p)).toBeCloseTo(237, 1);
  });

  it('zero distance returns the origin', () => {
    const p = projectPoint(32.3, -64.8, 123, 0);
    expect(p.lat).toBeCloseTo(32.3, 9);
    expect(p.lon).toBeCloseTo(-64.8, 9);
  });

  it('normalises longitude across the antimeridian', () => {
    const p = projectPoint(0, 179.999, 90, 1000);
    expect(p.lon).toBeLessThan(0); // wrapped to the -180 side
    expect(p.lon).toBeGreaterThanOrEqual(-180);
  });
});

describe('bearingDeltaDeg', () => {
  it('handles plain differences', () => {
    expect(bearingDeltaDeg(90, 45)).toBe(45);
    expect(bearingDeltaDeg(45, 90)).toBe(45);
  });

  it('handles the 0/360 seam', () => {
    expect(bearingDeltaDeg(350, 10)).toBe(20);
    expect(bearingDeltaDeg(10, 350)).toBe(20);
    expect(bearingDeltaDeg(0, 360)).toBe(0);
  });

  it('caps at 180', () => {
    expect(bearingDeltaDeg(0, 180)).toBe(180);
    expect(bearingDeltaDeg(90, 271)).toBe(179);
  });
});

describe('isBreached', () => {
  const anchor = { lat: 32.3, lon: -64.8 };
  // ~100 m north of the anchor (bearing 0 from anchor)
  const north100 = projectPoint(anchor.lat, anchor.lon, 0, 100);
  // ~100 m south of the anchor (bearing 180 from anchor)
  const south100 = projectPoint(anchor.lat, anchor.lon, 180, 100);

  it('no breach inside the radius with the full-circle default', () => {
    expect(isBreached(anchor, 150, undefined, undefined, north100)).toBe(false);
    expect(isBreached(anchor, 150, 360, 0, north100)).toBe(false);
  });

  it('breach outside the radius regardless of sector', () => {
    expect(isBreached(anchor, 50, undefined, undefined, north100)).toBe(true);
    expect(isBreached(anchor, 50, 90, 0, north100)).toBe(true);
  });

  it('sector: inside radius AND inside the cone is not a breach', () => {
    // boat bears 000 from anchor, cone centred 000 ±45
    expect(isBreached(anchor, 150, 90, 0, north100)).toBe(false);
  });

  it('sector: inside radius but outside the cone is a breach', () => {
    // boat bears 180 from anchor, cone centred 000 ±45
    expect(isBreached(anchor, 150, 90, 0, south100)).toBe(true);
  });

  it('sector wraparound: cone centred on 000 accepts bearings just either side of north', () => {
    const east350 = projectPoint(anchor.lat, anchor.lon, 350, 100);
    const east10 = projectPoint(anchor.lat, anchor.lon, 10, 100);
    const east30 = projectPoint(anchor.lat, anchor.lon, 30, 100);
    expect(isBreached(anchor, 150, 40, 0, east350)).toBe(false); // 10° off centre, half-width 20
    expect(isBreached(anchor, 150, 40, 0, east10)).toBe(false);
    expect(isBreached(anchor, 150, 40, 0, east30)).toBe(true); // 30° off centre
  });

  it('sector wraparound: cone centred near 360 works the same', () => {
    const b5 = projectPoint(anchor.lat, anchor.lon, 5, 100);
    expect(isBreached(anchor, 150, 40, 355, b5)).toBe(false); // 10° off 355
    const b40 = projectPoint(anchor.lat, anchor.lon, 40, 100);
    expect(isBreached(anchor, 150, 40, 355, b40)).toBe(true); // 45° off 355
  });

  it('boat sitting on the anchor point is never a sector breach', () => {
    expect(isBreached(anchor, 50, 30, 180, anchor)).toBe(false);
  });

  it('coneDeg present but no coneCenterDeg falls back to full circle', () => {
    expect(isBreached(anchor, 150, 90, undefined, south100)).toBe(false);
  });
});
