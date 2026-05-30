import { describe, it, expect } from 'vitest';
import { orderedPlanFromRoute } from './plan-via.js';

const WPS = [
  { id: 'a', lat: 38, lon: -64 },
  { id: 'b', lat: 39, lon: -63 },
  { id: 'c', lat: 40, lon: -62 },
];

describe('orderedPlanFromRoute', () => {
  it('splits a saved route into start / via / end', () => {
    const r = orderedPlanFromRoute({ id: 'r1', name: 'R', waypointIds: ['a', 'b', 'c'] }, WPS);
    expect(r).toEqual({
      start: { lat: 38, lon: -64 },
      via: [{ lat: 39, lon: -63 }],
      end: { lat: 40, lon: -62 },
    });
  });

  it('a two-waypoint route has no intermediates', () => {
    const r = orderedPlanFromRoute({ id: 'r1', name: 'R', waypointIds: ['a', 'c'] }, WPS);
    expect(r).toEqual({ start: { lat: 38, lon: -64 }, via: [], end: { lat: 40, lon: -62 } });
  });

  it('skips waypoint ids that no longer resolve', () => {
    const r = orderedPlanFromRoute({ id: 'r1', name: 'R', waypointIds: ['a', 'gone', 'c'] }, WPS);
    expect(r?.via).toEqual([]); // 'gone' dropped ⇒ just start + end
  });

  it('returns null when fewer than two waypoints resolve', () => {
    expect(
      orderedPlanFromRoute({ id: 'r1', name: 'R', waypointIds: ['a', 'gone'] }, WPS),
    ).toBeNull();
  });
});
