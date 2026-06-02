import { describe, it, expect } from 'vitest';
import { haversineKm, nearestStation } from './nearest.js';
import type { Station } from './types.js';

const A: Station = { id: 'A', name: 'Alpha', lat: 50.0, lon: -1.0 };
const B: Station = { id: 'B', name: 'Bravo', lat: 50.5, lon: -1.0 };
const stations = [A, B];

describe('haversineKm', () => {
  it('is ~0 for identical points', () => {
    expect(haversineKm(50, -1, 50, -1)).toBeCloseTo(0, 6);
  });
  it('is ~55.6 km for 0.5° of latitude', () => {
    expect(haversineKm(50, -1, 50.5, -1)).toBeGreaterThan(54);
    expect(haversineKm(50, -1, 50.5, -1)).toBeLessThan(57);
  });
});

describe('nearestStation', () => {
  it('picks the closest station with no current', () => {
    expect(nearestStation(stations, { lat: 50.05, lon: -1.0 }, null)?.id).toBe('A');
  });
  it('returns null for an empty list', () => {
    expect(nearestStation([], { lat: 50, lon: -1 }, null)).toBeNull();
  });
  it('keeps the current station inside the hysteresis margin', () => {
    const pos = { lat: 50.26, lon: -1.0 };
    expect(nearestStation(stations, pos, A, 5)?.id).toBe('A');
  });
  it('switches when a candidate is closer by more than the margin', () => {
    expect(nearestStation(stations, { lat: 50.5, lon: -1.0 }, A, 5)?.id).toBe('B');
  });
});
