import { describe, it, expect } from 'vitest';
import { buildRouteWeatherSeries } from './route-weather';
import { MS_TO_KN } from './units';
import type { Route, RouteLeg } from '@g5000/routing';

function leg(partial: Partial<RouteLeg> & { t: number }): RouteLeg {
  return {
    lat: 40,
    lon: -60,
    heading: 0,
    cog: 0,
    twa: Math.PI / 4,
    tws: 5,
    bsp: 3,
    sogGround: 3.2,
    ...partial,
  };
}

function route(legs: RouteLeg[]): Route {
  return {
    legs,
    start: legs[0]!.t,
    end: legs[legs.length - 1]!.t,
    distance: 0,
    model: 'GFS',
    usedCurrents: false,
    polarId: 'test',
  };
}

const threeLegs = route([
  leg({ t: 0, tws: 5, bsp: 3, sogGround: 3.2, lat: 40, lon: -60, tack: 'starboard' }),
  leg({ t: 3600, tws: 8, bsp: 4, sogGround: 4.1, lat: 41, lon: -61, motoring: true, tack: 'port' }),
  leg({ t: 7200, tws: 6, bsp: 3.5, sogGround: 3.5, lat: 42, lon: -62 }),
]);

describe('buildRouteWeatherSeries', () => {
  it('samples on the step grid from start to end inclusive', () => {
    const { points } = buildRouteWeatherSeries(threeLegs, 1800);
    expect(points.map((p) => p.t)).toEqual([0, 1800, 3600, 5400, 7200]);
  });

  it('takes values from the governing leg (last leg starting at or before t)', () => {
    const { points } = buildRouteWeatherSeries(threeLegs, 1800);
    // t=1800 is still inside leg 0; t=3600 and 5400 are inside leg 1.
    expect(points[1]).toMatchObject({ tws: 5, bsp: 3, sog: 3.2, motoring: false, lat: 40 });
    expect(points[2]).toMatchObject({ tws: 8, bsp: 4, sog: 4.1, motoring: true, lat: 41 });
    expect(points[3]).toMatchObject({ tws: 8, motoring: true });
    // Final sample lands on the last leg.
    expect(points[4]).toMatchObject({ tws: 6, motoring: false, lat: 42 });
  });

  it('converts TWA to degrees', () => {
    const { points } = buildRouteWeatherSeries(threeLegs, 3600);
    expect(points[0]!.twaDeg).toBeCloseTo(45, 6);
  });

  it('appends a final sample at route.end when the step does not divide the span', () => {
    const r = route([leg({ t: 0 }), leg({ t: 5000, tws: 9 })]);
    const { points } = buildRouteWeatherSeries(r, 1800);
    expect(points.map((p) => p.t)).toEqual([0, 1800, 3600, 5000]);
    expect(points[3]!.tws).toBe(9);
  });

  it('does not duplicate the end sample when the step divides the span exactly', () => {
    const r = route([leg({ t: 0 }), leg({ t: 3600 })]);
    const { points } = buildRouteWeatherSeries(r, 1800);
    expect(points.map((p) => p.t)).toEqual([0, 1800, 3600]);
  });

  it('derives wind direction from heading + tack-signed TWA', () => {
    const r = route([
      leg({ t: 0, heading: Math.PI / 2, twa: Math.PI / 4, tack: 'starboard' }), // 90 + 45
      leg({ t: 3600, heading: Math.PI / 2, twa: Math.PI / 4, tack: 'port' }), // 90 - 45
      leg({ t: 7200, heading: 0, twa: Math.PI / 4 }), // no tack → unknown sign
    ]);
    const { points } = buildRouteWeatherSeries(r, 3600);
    expect(points[0]!.windDirDeg).toBeCloseTo(135, 6);
    expect(points[1]!.windDirDeg).toBeCloseTo(45, 6);
    expect(points[2]!.windDirDeg).toBeUndefined();
  });

  it('wraps wind direction into [0, 360)', () => {
    const r = route([
      leg({ t: 0, heading: 0.1, twa: 0.3, tack: 'port' }), // negative before wrap
      leg({ t: 3600 }),
    ]);
    const { points } = buildRouteWeatherSeries(r, 3600);
    expect(points[0]!.windDirDeg).toBeGreaterThanOrEqual(0);
    expect(points[0]!.windDirDeg).toBeLessThan(360);
    expect(points[0]!.windDirDeg).toBeCloseTo(360 + (0.1 - 0.3) * (180 / Math.PI), 4);
  });

  it('summarises max/avg TWS in knots, motoring %, and hours', () => {
    const { points, summary } = buildRouteWeatherSeries(threeLegs, 1800);
    expect(summary.maxTwsKn).toBeCloseTo(8 * MS_TO_KN, 6);
    const avg = points.reduce((a, p) => a + p.tws * MS_TO_KN, 0) / points.length;
    expect(summary.avgTwsKn).toBeCloseTo(avg, 6);
    // 2 of 5 samples motoring.
    expect(summary.motoringPct).toBeCloseTo(40, 6);
    expect(summary.hours).toBeCloseTo(2, 6);
  });

  it('returns an empty series for a route with no legs', () => {
    const r: Route = {
      legs: [],
      start: 0,
      end: 0,
      distance: 0,
      model: 'GFS',
      usedCurrents: false,
      polarId: 'test',
    };
    const { points, summary } = buildRouteWeatherSeries(r);
    expect(points).toEqual([]);
    expect(summary).toEqual({ maxTwsKn: 0, avgTwsKn: 0, motoringPct: 0, hours: 0 });
  });
});
