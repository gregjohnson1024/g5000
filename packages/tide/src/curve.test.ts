import { describe, it, expect } from 'vitest';
import { interpolateHeight, heightNow, tideState } from './curve.js';
import type { TidalEvent } from './types.js';

const min = 60_000;
const events: TidalEvent[] = [
  { type: 'LW', timeMs: 0, heightM: 1.0 },
  { type: 'HW', timeMs: 6 * 60 * min, heightM: 5.0 },
  { type: 'LW', timeMs: 12 * 60 * min, heightM: 1.2 },
];

describe('interpolateHeight', () => {
  it('returns the endpoints exactly', () => {
    expect(interpolateHeight(0, 1, 100, 5, 0)).toBeCloseTo(1, 9);
    expect(interpolateHeight(0, 1, 100, 5, 100)).toBeCloseTo(5, 9);
  });
  it('returns the midpoint mean at the half-time', () => {
    expect(interpolateHeight(0, 1, 100, 5, 50)).toBeCloseTo(3, 9);
  });
  it('works on a falling segment (HW→LW) too', () => {
    expect(interpolateHeight(0, 5, 100, 1, 50)).toBeCloseTo(3, 9);
  });
});

describe('heightNow', () => {
  it('interpolates within the bracketing pair', () => {
    expect(heightNow(events, 3 * 60 * min)).toBeCloseTo(3.0, 6);
  });
  it('returns null before the first event (no bracket)', () => {
    expect(heightNow(events, -1 * min)).toBeNull();
  });
  it('returns null after the last event', () => {
    expect(heightNow(events, 13 * 60 * min)).toBeNull();
  });
});

describe('tideState', () => {
  it('is rising on a LW→HW segment away from the ends', () => {
    expect(tideState(events, 3 * 60 * min)).toBe('rising');
  });
  it('is falling on a HW→LW segment away from the ends', () => {
    expect(tideState(events, 9 * 60 * min)).toBe('falling');
  });
  it('is stand within the window of an event', () => {
    expect(tideState(events, 6 * 60 * min + 5 * min)).toBe('stand');
  });
  it('is null with no bracketing pair', () => {
    expect(tideState(events, 13 * 60 * min)).toBeNull();
  });
});
