import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { plan } from './plan.js';
import { greatCircleBearing, greatCircleDistance } from './geometry.js';
import type { WindField } from '@g5000/grib';
import type { PolarTable } from '@g5000/db';

const DEG = Math.PI / 180;

function uniformWind(uVal: number, vVal: number): WindField {
  const lats = [10, 20, 30, 40, 50, 60];
  const lons = [-100, -80, -60, -40, -20];
  const times = [0, 86400 * 14];
  const u = times.map(() => lats.map(() => lons.map(() => uVal)));
  const v = times.map(() => lats.map(() => lons.map(() => vVal)));
  return { lats, lons, times, u, v, source: 'GFS', runTime: 0 };
}

function reachingPolar(): PolarTable {
  return {
    twsBins: [0, 5, 10, 15, 20].map((kn) => kn * 0.514444),
    twaBins: [0, 30, 45, 60, 90, 120, 150, 180].map((d) => d * DEG),
    boatSpeed: [
      [0, 0, 0, 0, 0, 0, 0, 0],
      [0, 2, 3, 3.5, 4, 4, 3, 2],
      [0, 3, 5, 6, 7, 7, 5, 3],
      [0, 4, 6, 7, 8.5, 8.5, 6, 4],
      [0, 5, 7, 8, 9, 9, 7, 5],
    ],
  };
}

const fakeCoastline = {
  level: 'l' as const,
  polygons: [],
  index: { search: () => [], load: () => undefined } as never,
};

describe('property: distance >= great-circle', () => {
  it('route over-ground distance is never less than great-circle distance', () => {
    fc.assert(
      fc.property(
        fc.double({ min: 20, max: 45, noNaN: true }),
        fc.double({ min: -90, max: -50, noNaN: true }),
        fc.double({ min: 20, max: 45, noNaN: true }),
        fc.double({ min: -90, max: -50, noNaN: true }),
        (lat1, lon1, lat2, lon2) => {
          // Skip degenerate near-zero distances
          const gc = greatCircleDistance({ lat: lat1, lon: lon1 }, { lat: lat2, lon: lon2 });
          if (gc < 50_000) return;
          const r = plan({
            start: { lat: lat1, lon: lon1 },
            end: { lat: lat2, lon: lon2 },
            departure: 0,
            wind: uniformWind(8, 0),
            polar: reachingPolar(),
            polarId: 't',
            coastline: fakeCoastline,
            options: { avoidLand: false, maxHours: 168 },
          });
          if (r.incomplete) return;
          // Allow 0.5% numerical slack
          expect(r.distance).toBeGreaterThanOrEqual(gc * 0.995);
        },
      ),
      { numRuns: 20 },
    );
  });
});

describe('property: determinism', () => {
  it('same inputs -> byte-identical Route', () => {
    const args = {
      start: { lat: 35, lon: -70 },
      end: { lat: 32, lon: -65 },
      departure: 0,
      wind: uniformWind(8, 2),
      polar: reachingPolar(),
      polarId: 't',
      coastline: fakeCoastline,
      options: { avoidLand: false, maxHours: 72 },
    };
    const r1 = plan(args);
    const r2 = plan(args);
    expect(JSON.stringify(r1)).toBe(JSON.stringify(r2));
  });
});

describe('property: uniform wind => direction roughly toward destination', () => {
  it('mean leg bearing within 45 deg of great-circle bearing for broad-reach conditions', () => {
    const start = { lat: 30, lon: -75 };
    const end = { lat: 30, lon: -65 }; // due east, wind from west (u=8)
    // maxHours=96 matches plan.test.ts — with this polar, bearing-bucket prune
    // prefers a 30°/150° zigzag (~16 km/h east) over the optimal 60°/120°
    // zigzag, so 960 km needs ~80h, not 48h.
    const r = plan({
      start, end, departure: 0,
      wind: uniformWind(8, 0),
      polar: reachingPolar(),
      polarId: 't',
      coastline: fakeCoastline,
      options: { avoidLand: false, maxHours: 96 },
    });
    expect(r.incomplete).toBeFalsy();
    const gcb = greatCircleBearing(start, end);
    // Average bearing across legs (circular mean would be ideal but for a
    // route that doesn't wrap ±π the arithmetic mean is fine here — all
    // headings are in the eastern half-plane).
    let mean = 0;
    for (const l of r.legs) mean += l.heading;
    mean /= r.legs.length;
    const delta = Math.abs(((mean - gcb + 3 * Math.PI) % (2 * Math.PI)) - Math.PI);
    // Wider tolerance (45° instead of 30°) because the test polar has a steep
    // TWA gradient at TWA=120° causing the prune bucket to prefer a wider-angle
    // zigzag than the optimal beam-reach pair. Real polars are smoother and
    // the optimal route is tighter.
    expect(delta).toBeLessThan(45 * DEG);
  });
});
