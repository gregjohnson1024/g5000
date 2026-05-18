import { describe, it, expect } from 'vitest';
import { bboxesEqual, updateCorner, type Bbox } from './forecast-roi-math';

const BASE: Bbox = { latMin: 40, latMax: 44, lonMin: -72, lonMax: -68 };

describe('updateCorner', () => {
  describe('outward drag (grow the box)', () => {
    it('sw outward moves latMin south and lonMin west', () => {
      const next = updateCorner(BASE, 'sw', { lat: 38, lng: -74 });
      expect(next).toEqual({ latMin: 38, latMax: 44, lonMin: -74, lonMax: -68 });
    });
    it('se outward moves latMin south and lonMax east', () => {
      const next = updateCorner(BASE, 'se', { lat: 38, lng: -66 });
      expect(next).toEqual({ latMin: 38, latMax: 44, lonMin: -72, lonMax: -66 });
    });
    it('ne outward moves latMax north and lonMax east', () => {
      const next = updateCorner(BASE, 'ne', { lat: 46, lng: -66 });
      expect(next).toEqual({ latMin: 40, latMax: 46, lonMin: -72, lonMax: -66 });
    });
    it('nw outward moves latMax north and lonMin west', () => {
      const next = updateCorner(BASE, 'nw', { lat: 46, lng: -74 });
      expect(next).toEqual({ latMin: 40, latMax: 46, lonMin: -74, lonMax: -68 });
    });
  });

  describe('inward drag (shrink the box) — regression for the bug the user reported', () => {
    it('sw inward shrinks latMin north and lonMin east', () => {
      // Before the fix this returned BASE unchanged because the min/max
      // reduce kept the other corners' extremes in play.
      const next = updateCorner(BASE, 'sw', { lat: 41, lng: -71 });
      expect(next).toEqual({ latMin: 41, latMax: 44, lonMin: -71, lonMax: -68 });
    });
    it('se inward shrinks latMin north and lonMax west', () => {
      const next = updateCorner(BASE, 'se', { lat: 41, lng: -69 });
      expect(next).toEqual({ latMin: 41, latMax: 44, lonMin: -72, lonMax: -69 });
    });
    it('ne inward shrinks latMax south and lonMax west', () => {
      const next = updateCorner(BASE, 'ne', { lat: 43, lng: -69 });
      expect(next).toEqual({ latMin: 40, latMax: 43, lonMin: -72, lonMax: -69 });
    });
    it('nw inward shrinks latMax south and lonMin east', () => {
      const next = updateCorner(BASE, 'nw', { lat: 43, lng: -71 });
      expect(next).toEqual({ latMin: 40, latMax: 43, lonMin: -71, lonMax: -68 });
    });
  });

  describe('cross-over (drag past the opposite corner)', () => {
    it('sw dragged past ne normalises to a valid bbox', () => {
      // SW corner ends up north-east of NE corner — the rectangle "flips
      // inside out". Normalise to canonical min/max.
      const next = updateCorner(BASE, 'sw', { lat: 46, lng: -64 });
      expect(next.latMin).toBeLessThan(next.latMax);
      expect(next.lonMin).toBeLessThan(next.lonMax);
      expect(next).toEqual({ latMin: 44, latMax: 46, lonMin: -68, lonMax: -64 });
    });
    it('ne dragged south-west past sw normalises', () => {
      const next = updateCorner(BASE, 'ne', { lat: 38, lng: -74 });
      expect(next).toEqual({ latMin: 38, latMax: 40, lonMin: -74, lonMax: -72 });
    });
  });
});

describe('bboxesEqual', () => {
  it('exact equality', () => {
    expect(bboxesEqual(BASE, { ...BASE })).toBe(true);
  });
  it('inequality on any coordinate', () => {
    expect(bboxesEqual(BASE, { ...BASE, latMin: 40.0001 })).toBe(false);
    expect(bboxesEqual(BASE, { ...BASE, lonMax: -68.001 })).toBe(false);
  });
  it('tolerates sub-arc-second floating-point drift', () => {
    expect(bboxesEqual(BASE, { ...BASE, latMin: 40 + 1e-12 })).toBe(true);
  });
});
