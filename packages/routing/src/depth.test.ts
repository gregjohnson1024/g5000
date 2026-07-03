import { describe, it, expect } from 'vitest';
import { plan } from './plan.js';
import type { DepthField } from './depth.js';
import type { PlanInput } from './types.js';
import type { WindField } from '@g5000/grib';
import type { PolarTable } from '@g5000/db';

/** Constant 10 m/s wind from west (u=10, v=0) over a wide bbox & long time. */
function uniformWind(): WindField {
  const lats = [20, 30, 40, 50];
  const lons = [-80, -70, -60, -50];
  const times = [0, 86400 * 7]; // 0 → +7 days
  const u = times.map(() => lats.map(() => lons.map(() => 10)));
  const v = times.map(() => lats.map(() => lons.map(() => 0)));
  return { lats, lons, times, u, v, source: 'GFS', runTime: 0 };
}

/** Trivial polar: 6 m/s upwind, 8 m/s reach, 5 m/s downwind, etc. */
function simplePolar(): PolarTable {
  const DEG = Math.PI / 180;
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

/** Shallow strip crossing the direct start→end line: 2 m inside the box,
 *  100 m everywhere else. Wide in latitude so the only way past is a real
 *  detour, not a one-step hop over it. */
const SHALLOW = { latMin: 29, latMax: 31, lonMin: -71, lonMax: -69 };
function stripDepth(): DepthField {
  return {
    depthAt: (lat, lon) =>
      lat >= SHALLOW.latMin &&
      lat <= SHALLOW.latMax &&
      lon >= SHALLOW.lonMin &&
      lon <= SHALLOW.lonMax
        ? 2
        : 100,
  };
}

function baseInput(): PlanInput {
  return {
    start: { lat: 30, lon: -75 },
    end: { lat: 30, lon: -65 }, // 960 km east through the shallow strip
    departure: 0,
    wind: uniformWind(),
    polar: simplePolar(),
    polarId: 'test',
    coastline: fakeCoastline,
    options: { avoidLand: false, maxHours: 168, stepMinutes: 60 },
  };
}

describe('plan depth constraint', () => {
  it('detours around a shallow strip between start and end', () => {
    const input = baseInput();
    const route = plan({
      ...input,
      depth: stripDepth(),
      options: { ...input.options, minDepthM: 5 },
    });
    expect(route.incomplete).toBeFalsy();
    // No leg vertex may sit inside the shallow strip.
    for (const l of route.legs) {
      const inStrip =
        l.lat >= SHALLOW.latMin &&
        l.lat <= SHALLOW.latMax &&
        l.lon >= SHALLOW.lonMin &&
        l.lon <= SHALLOW.lonMax;
      expect(inStrip).toBe(false);
    }
    // A real detour: some vertex leaves the shallow strip's latitude band.
    expect(route.legs.some((l) => l.lat > SHALLOW.latMax || l.lat < SHALLOW.latMin)).toBe(true);
  });

  it('without the constraint the direct route crosses the strip (sanity)', () => {
    const route = plan(baseInput());
    expect(route.incomplete).toBeFalsy();
    expect(
      route.legs.some(
        (l) =>
          l.lat >= SHALLOW.latMin &&
          l.lat <= SHALLOW.latMax &&
          l.lon >= SHALLOW.lonMin &&
          l.lon <= SHALLOW.lonMax,
      ),
    ).toBe(true);
  });

  it('refuses to close into a destination shallower than minDepthM', () => {
    const input = baseInput();
    const route = plan({
      ...input,
      end: { lat: 30, lon: -70 }, // inside the shallow strip
      depth: stripDepth(),
      options: { ...input.options, maxHours: 48, minDepthM: 5 },
    });
    expect(route.incomplete).toBe(true);
  });

  it('depth field without minDepthM is byte-identical to no depth at all', () => {
    const baseline = plan(baseInput());
    const withField = plan({ ...baseInput(), depth: stripDepth() });
    expect(withField).toStrictEqual(baseline);
  });

  it('minDepthM without a depth field is byte-identical to no constraint', () => {
    const baseline = plan(baseInput());
    const input = baseInput();
    const withOption = plan({ ...input, options: { ...input.options, minDepthM: 5 } });
    expect(withOption).toStrictEqual(baseline);
  });

  it('unknown depth (null) passes — never fabricates a blocker', () => {
    const input = baseInput();
    const nullField: DepthField = { depthAt: () => null };
    const baseline = plan(baseInput());
    const route = plan({
      ...input,
      depth: nullField,
      options: { ...input.options, minDepthM: 5 },
    });
    expect(route).toStrictEqual(baseline);
  });
});
