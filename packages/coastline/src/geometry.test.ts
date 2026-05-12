import { describe, it, expect } from 'vitest';
import { pointInRing, segmentsIntersect, segmentCrossesRing } from './geometry.js';

const SQUARE: Array<[number, number]> = [
  [-1, -1], [1, -1], [1, 1], [-1, 1], [-1, -1],
];

describe('pointInRing', () => {
  it('detects inside', () => {
    expect(pointInRing([0, 0], SQUARE)).toBe(true);
  });
  it('detects outside', () => {
    expect(pointInRing([2, 0], SQUARE)).toBe(false);
  });
  it('treats edge as outside (consistent boundary)', () => {
    expect(pointInRing([1, 0], SQUARE)).toBe(false);
  });
});

describe('segmentsIntersect', () => {
  it('detects crossing X', () => {
    expect(segmentsIntersect([0, 0], [2, 2], [0, 2], [2, 0])).toBe(true);
  });
  it('detects parallel non-intersecting', () => {
    expect(segmentsIntersect([0, 0], [2, 0], [0, 1], [2, 1])).toBe(false);
  });
  it('detects touching endpoints as intersecting', () => {
    expect(segmentsIntersect([0, 0], [2, 2], [2, 2], [4, 0])).toBe(true);
  });
});

describe('segmentCrossesRing', () => {
  it('true when segment enters the square', () => {
    expect(segmentCrossesRing([-2, 0], [0, 0], SQUARE)).toBe(true);
  });
  it('false when segment is entirely outside', () => {
    expect(segmentCrossesRing([-2, 0], [-1.5, 0], SQUARE)).toBe(false);
  });
  it('true when segment passes through', () => {
    expect(segmentCrossesRing([-2, 0], [2, 0], SQUARE)).toBe(true);
  });
});
