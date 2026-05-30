import { describe, it, expect } from 'vitest';
import { resolveTarget, type HitWaypoint } from './route-hit-test.js';

const wps: HitWaypoint[] = [
  { id: 'a', name: 'A', lat: 1, lon: 1 },
  { id: 'b', name: 'B', lat: 2, lon: 2 },
];
const byId = new Map(wps.map((w) => [w.id, w]));
const ctx = (routeIds: string[]) => ({ lat: 9, lon: 9, routeIds, waypointById: byId });

describe('resolveTarget', () => {
  it('waypoint hit, in route', () => {
    const t = resolveTarget(
      [{ layer: { id: 'waypoints-dot' }, properties: { id: 'a' } }],
      ctx(['a', 'b']),
    );
    expect(t).toEqual({ kind: 'waypoint', waypoint: wps[0], inRoute: true });
  });
  it('waypoint hit, not in route', () => {
    const t = resolveTarget(
      [{ layer: { id: 'waypoints-dot' }, properties: { id: 'b' } }],
      ctx(['a']),
    );
    expect(t).toEqual({ kind: 'waypoint', waypoint: wps[1], inRoute: false });
  });
  it('leg hit -> insertIndex = segIndex + 1', () => {
    const t = resolveTarget(
      [{ layer: { id: 'route-connector' }, properties: { segIndex: 2 } }],
      ctx(['a', 'b']),
    );
    expect(t).toEqual({ kind: 'leg', lat: 9, lon: 9, insertIndex: 3 });
  });
  it('waypoint takes precedence over leg', () => {
    const t = resolveTarget(
      [
        { layer: { id: 'route-connector' }, properties: { segIndex: 0 } },
        { layer: { id: 'waypoints-dot' }, properties: { id: 'a' } },
      ],
      ctx(['a']),
    );
    expect(t.kind).toBe('waypoint');
  });
  it('falls through to leg when the waypoint id is not in the map', () => {
    const t = resolveTarget(
      [
        { layer: { id: 'waypoints-dot' }, properties: { id: 'unknown' } },
        { layer: { id: 'route-connector' }, properties: { segIndex: 1 } },
      ],
      ctx(['a', 'b']),
    );
    expect(t).toEqual({ kind: 'leg', lat: 9, lon: 9, insertIndex: 2 });
  });
  it('empty water when nothing hit', () => {
    expect(resolveTarget([], ctx([]))).toEqual({ kind: 'empty', lat: 9, lon: 9 });
  });
});
