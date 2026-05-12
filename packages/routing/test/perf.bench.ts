// packages/routing/test/perf.bench.ts
import { bench, describe } from 'vitest';
import { plan } from '../src/plan.js';
import type { WindField } from '@g5000/grib';
import type { PolarTable } from '@g5000/db';

const DEG = Math.PI / 180;

function field(): WindField {
  const lats = Array.from({ length: 60 }, (_, i) => 20 + i * 0.5);
  const lons = Array.from({ length: 60 }, (_, i) => -85 + i * 0.5);
  const times = Array.from({ length: 8 }, (_, i) => i * 21600);
  const u = times.map(() => lats.map(() => lons.map(() => 8 + Math.random())));
  const v = times.map(() => lats.map(() => lons.map(() => 1 + Math.random())));
  return { lats, lons, times, u, v, source: 'GFS', runTime: 0 };
}

function polar(): PolarTable {
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

const fakeCoast = {
  level: 'l' as const,
  polygons: [],
  index: { search: () => [], load: () => undefined } as never,
};

describe('plan benchmarks', () => {
  bench(
    '3-day passage, 30-min step',
    () => {
      plan({
        start: { lat: 30, lon: -75 },
        end: { lat: 35, lon: -65 },
        departure: 0,
        wind: field(),
        polar: polar(),
        polarId: 't',
        coastline: fakeCoast,
        options: { avoidLand: false, maxHours: 72, stepMinutes: 30 },
      });
    },
    { iterations: 5, time: 5000 },
  );
});
