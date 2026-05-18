import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { plan } from './plan.js';
import type { PlanInput } from './types.js';
import type { SailWardrobe, PolarTable } from '@g5000/db';
import type { WindField } from '@g5000/grib';

const KN_TO_MS = 0.514444;
const DEG_TO_RAD = Math.PI / 180;

function flatPolar(speedKn: number): PolarTable {
  const ms = speedKn * KN_TO_MS;
  return {
    twsBins: [0, 5, 10, 15, 20, 25, 30].map((k) => k * KN_TO_MS),
    twaBins: [30, 60, 90, 120, 150, 180].map((d) => d * DEG_TO_RAD),
    boatSpeed: [0, 5, 10, 15, 20, 25, 30].map(() => [ms, ms, ms, ms, ms, ms]),
  };
}

function constWind(speedMs: number, dirRad: number): WindField {
  const lats = [28, 30, 32, 34];
  const lons = [-72, -70, -68, -66];
  const u = lats.map(() => lons.map(() => speedMs * Math.cos(dirRad)));
  const v = lats.map(() => lons.map(() => speedMs * Math.sin(dirRad)));
  return {
    lats,
    lons,
    times: [0, 86400],
    u: [u, u],
    v: [v, v],
    source: 'GFS',
    runTime: 0,
  };
}

const fakeCoastline = {
  level: 'l' as const,
  polygons: [],
  index: { search: () => [], load: () => undefined } as never,
};

function baseInput(wardrobe: SailWardrobe | null, polar: PolarTable | null): PlanInput {
  return {
    start: { lat: 30.5, lon: -69.5 },
    end: { lat: 32.0, lon: -67.0 },
    departure: 0,
    wind: constWind(8, Math.PI / 2),
    polar: polar ?? (undefined as never),
    polarId: polar ? 'test-polar' : 'wardrobe',
    coastline: fakeCoastline,
    options: { avoidLand: false, maxHours: 48 },
    wardrobe: wardrobe ?? undefined,
  } as PlanInput;
}

describe('plan() wardrobe mode', () => {
  it('is never slower than the active-config-only plan', () => {
    fc.assert(
      fc.property(
        fc.tuple(
          fc.float({ min: 4, max: 8, noNaN: true }),
          fc.float({ min: 4, max: 8, noNaN: true }),
        ),
        ([sA, sB]) => {
          const w: SailWardrobe = {
            configs: [
              { id: 'a', name: 'A', polar: flatPolar(sA) },
              { id: 'b', name: 'B', polar: flatPolar(sB) },
            ],
            activeConfigId: 'a',
          };
          const wardrobeRoute = plan(baseInput(w, null));
          const activeOnlyRoute = plan(baseInput(null, flatPolar(sA)));
          const wTime = wardrobeRoute.end - wardrobeRoute.start;
          const aTime = activeOnlyRoute.end - activeOnlyRoute.start;
          return wTime <= aTime + 1; // 1s slack for fp noise
        },
      ),
      { numRuns: 25 },
    );
  });

  it('records configId on each leg in wardrobe mode', () => {
    const w: SailWardrobe = {
      configs: [
        { id: 'slow', name: 'Slow', polar: flatPolar(3) },
        { id: 'fast', name: 'Fast', polar: flatPolar(7) },
      ],
      activeConfigId: 'slow',
    };
    const r = plan(baseInput(w, null));
    expect(r.legs.length).toBeGreaterThan(0);
    // Skip the start node (leg 0) — it has no propagated configId by design.
    const propagated = r.legs.slice(1);
    expect(propagated.length).toBeGreaterThan(0);
    for (const leg of propagated) {
      expect(leg.configId).toBeDefined();
    }
    // With flat polars the faster config wins everywhere.
    expect(propagated.every((l) => l.configId === 'fast')).toBe(true);
  });
});
