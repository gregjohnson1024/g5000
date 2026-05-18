import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { predictOcs } from './ocs-predictor.js';

const port = { lat: 41.5, lon: -71.3 };
const stbd = { lat: 41.5, lon: -71.29 };
const south = { lat: 41.491, lon: -71.295 }; // ~1 km south of mid

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-05-18T12:00:00Z'));
});
afterEach(() => vi.useRealTimers());

describe('predictOcs', () => {
  it('returns null when startMs is null', () => {
    expect(
      predictOcs({
        pos: south,
        cogRad: 0,
        sogMs: 5,
        cogConcentration: 0.9,
        line: { port, stbd },
        startMs: null,
        lookAheadSec: 10,
      }),
    ).toBeNull();
  });
  it('returns null when SOG < 0.5 kn', () => {
    expect(
      predictOcs({
        pos: south,
        cogRad: 0,
        sogMs: 0.2,
        cogConcentration: 0.9,
        line: { port, stbd },
        startMs: Date.now() + 5000,
        lookAheadSec: 10,
      }),
    ).toBeNull();
  });
  it('returns null when COG concentration < 0.7', () => {
    expect(
      predictOcs({
        pos: south,
        cogRad: 0,
        sogMs: 5,
        cogConcentration: 0.5,
        line: { port, stbd },
        startMs: Date.now() + 5000,
        lookAheadSec: 10,
      }),
    ).toBeNull();
  });
  it('returns null when line endpoints are missing', () => {
    expect(
      predictOcs({
        pos: south,
        cogRad: 0,
        sogMs: 5,
        cogConcentration: 0.9,
        line: { port },
        startMs: Date.now() + 5000,
        lookAheadSec: 10,
      }),
    ).toBeNull();
  });
  it('returns false when secs-until-start exceeds lookAheadSec', () => {
    expect(
      predictOcs({
        pos: south,
        cogRad: 0,
        sogMs: 5,
        cogConcentration: 0.9,
        line: { port, stbd },
        startMs: Date.now() + 30_000,
        lookAheadSec: 10,
      }),
    ).toBe(false);
  });
  it('returns false when the race is already on (secsUntilStart ≤ 0)', () => {
    expect(
      predictOcs({
        pos: south,
        cogRad: 0,
        sogMs: 5,
        cogConcentration: 0.9,
        line: { port, stbd },
        startMs: Date.now() - 1000,
        lookAheadSec: 10,
      }),
    ).toBe(false);
  });
  it('returns true when boat will cross line within lookAhead and before start', () => {
    // Boat ~1 km south, COG = 0 (north), SOG = 200 m/s → projected
    // distance over 10 s = 2000 m → crosses the line easily.
    // startMs is 8 s out, so the projection happens before the gun.
    expect(
      predictOcs({
        pos: south,
        cogRad: 0,
        sogMs: 200,
        cogConcentration: 0.9,
        line: { port, stbd },
        startMs: Date.now() + 8000,
        lookAheadSec: 10,
      }),
    ).toBe(true);
  });
  it('returns false when boat is heading away from line', () => {
    expect(
      predictOcs({
        pos: south,
        cogRad: Math.PI,
        sogMs: 5,
        cogConcentration: 0.9,
        line: { port, stbd },
        startMs: Date.now() + 8000,
        lookAheadSec: 10,
      }),
    ).toBe(false);
  });
});
