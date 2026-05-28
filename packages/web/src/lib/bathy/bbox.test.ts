import { describe, expect, it } from 'vitest';
import { snapBbox, cacheKey, gmrtUrl, type Bbox } from './bbox.js';

describe('bathy bbox helpers', () => {
  it('snaps outward to whole degrees and clamps span', () => {
    const snapped = snapBbox({ latMin: 40.3, latMax: 41.7, lonMin: -71.4, lonMax: -70.2 });
    expect(snapped).toEqual({ latMin: 40, latMax: 42, lonMin: -72, lonMax: -70 });
  });

  it('clamps an over-large bbox to MAX_SPAN_DEG around its centre', () => {
    const snapped = snapBbox({ latMin: 0, latMax: 50, lonMin: -100, lonMax: -10 });
    expect(snapped.latMax - snapped.latMin).toBeLessThanOrEqual(20);
    expect(snapped.lonMax - snapped.lonMin).toBeLessThanOrEqual(20);
  });

  it('cacheKey is stable and resolution-aware', () => {
    const b: Bbox = { latMin: 40, latMax: 42, lonMin: -72, lonMax: -70 };
    expect(cacheKey(b, 'low')).toBe('40_42_-72_-70_low');
    expect(cacheKey(b, 'high')).toBe('40_42_-72_-70_high');
  });

  it('gmrtUrl carries bbox + format + resolution', () => {
    const u = new URL(gmrtUrl({ latMin: 40, latMax: 42, lonMin: -72, lonMax: -70 }, 'low'));
    expect(u.hostname).toBe('www.gmrt.org');
    expect(u.searchParams.get('format')).toBe('esriascii');
    expect(u.searchParams.get('minlatitude')).toBe('40');
    expect(u.searchParams.get('maxlongitude')).toBe('-70');
    expect(u.searchParams.get('resolution')).toBe('low');
  });
});
