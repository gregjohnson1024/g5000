import { describe, it, expect } from 'vitest';
import type { WindField } from '@g5000/grib';
import type { PolarTable } from '@g5000/db';
import type { Coastline } from '@g5000/coastline';
import { plan } from './index.js';
import type { LatLon } from './index.js';

const NO_COAST = { level: 'i', polygons: [], index: undefined } as unknown as Coastline;
const DEP = 1_768_000_000;

const SLOW_POLAR: PolarTable = {
  twsBins: [0, 100],
  twaBins: [0, Math.PI],
  boatSpeed: [
    [1.5, 1.5],
    [1.5, 1.5],
  ],
};

function uniformWind(): WindField {
  const lats = [30, 35, 40, 45];
  const lons = [-70, -65, -60, -55];
  const times = [DEP, DEP + 168 * 3600];
  const u = times.map(() => lats.map(() => lons.map(() => 5)));
  const v = times.map(() => lats.map(() => lons.map(() => 0)));
  return { lats, lons, times, u, v, source: 'GFS', runTime: DEP };
}

const START: LatLon = { lat: 38, lon: -64 };
const END: LatLon = { lat: 40, lon: -62 };

it('auto-motor floors boat speed when polar speed is below the threshold', () => {
  const r = plan({
    start: START, end: END, departure: DEP, wind: uniformWind(),
    polar: SLOW_POLAR, polarId: 'slow', coastline: NO_COAST,
    options: { avoidLand: false, autoMotor: { minSail: 1.5432, motor: 2.572 } },
  });
  const sailLegs = r.legs.filter((l) => l.bsp > 0 && Math.abs(l.bsp - 1.5) < 0.01);
  expect(sailLegs.length).toBe(0);
  expect(r.legs.some((l) => Math.abs(l.bsp - 2.572) < 0.01)).toBe(true);
});

it('without autoMotor the polar speed is used unchanged', () => {
  const r = plan({
    start: START, end: END, departure: DEP, wind: uniformWind(),
    polar: SLOW_POLAR, polarId: 'slow', coastline: NO_COAST,
    options: { avoidLand: false },
  });
  expect(r.legs.some((l) => Math.abs(l.bsp - 1.5) < 0.01)).toBe(true);
});

it('cog is populated and equals heading when currents are off', () => {
  const r = plan({
    start: START, end: END, departure: DEP, wind: uniformWind(),
    polar: SLOW_POLAR, polarId: 'slow', coastline: NO_COAST,
    options: { avoidLand: false, autoMotor: { minSail: 1.5432, motor: 2.572 } },
  });
  const moving = r.legs.filter((l) => l.bsp > 0).slice(1);
  expect(moving.length).toBeGreaterThan(0);
  for (const l of moving) {
    expect(Math.abs(l.cog - l.heading)).toBeLessThan(1e-6);
  }
});
