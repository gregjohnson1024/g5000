import { describe, it, expect } from 'vitest';
import type { WindField } from '@g5000/grib';
import type { PolarTable } from '@g5000/db';
import type { Coastline } from '@g5000/coastline';
import type { LatLon, PlanInput } from './types.js';
import { plan } from './plan.js';
import { planVia } from './plan-via.js';

const NO_COAST = { level: 'i', polygons: [], index: undefined } as unknown as Coastline;
const DEP = 1_768_000_000;

// Constant boat speed regardless of wind ⇒ deterministic, always-completing routes.
const UNIFORM_POLAR: PolarTable = {
  twsBins: [0, 100],
  twaBins: [0, Math.PI],
  boatSpeed: [
    [5.144, 5.144],
    [5.144, 5.144],
  ],
};

function uniformWind(): WindField {
  const lats = [36, 38, 40, 42];
  const lons = [-66, -64, -62, -60];
  const times = [DEP, DEP + 168 * 3600];
  const u = times.map(() => lats.map(() => lons.map(() => 5)));
  const v = times.map(() => lats.map(() => lons.map(() => 0)));
  return { lats, lons, times, u, v, source: 'GFS', runTime: DEP };
}

const START: LatLon = { lat: 38, lon: -64 };
const MID: LatLon = { lat: 39, lon: -63 };
const MID2: LatLon = { lat: 39.5, lon: -62.5 };
const END: LatLon = { lat: 40, lon: -62 };

function baseInput(overrides: Partial<PlanInput> = {}): PlanInput {
  return {
    start: START,
    end: END,
    departure: DEP,
    wind: uniformWind(),
    polar: UNIFORM_POLAR,
    polarId: 'uniform',
    coastline: NO_COAST,
    options: { avoidLand: false },
    ...overrides,
  };
}

describe('planVia', () => {
  it('with no intermediates equals plan()', () => {
    const direct = plan(baseInput());
    const via = planVia(baseInput(), []);
    expect(via.legs).toEqual(direct.legs);
    expect(via.distance).toBeCloseTo(direct.distance, 6);
    expect(via.end).toBe(direct.end);
    expect(via.incomplete).toBeUndefined();
  });

  it('chains two segments: total distance sums, ETA continues, vertex deduped', () => {
    const seg0 = plan(baseInput({ end: MID }));
    const seg1 = plan(baseInput({ start: MID, departure: seg0.end }));
    const full = planVia(baseInput(), [MID]);

    expect(full.start).toBe(DEP);
    expect(full.end).toBe(seg1.end); // seg1 departed at seg0.end ⇒ ETA chain
    expect(full.distance).toBeCloseTo(seg0.distance + seg1.distance, 0);
    // Vertex dedup: seg1's synthetic start leg (== MID) is dropped.
    expect(full.legs.length).toBe(seg0.legs.length + seg1.legs.length - 1);
    const seam = full.legs[seg0.legs.length - 1]!;
    expect(seam.lat).toBeCloseTo(MID.lat, 6);
    expect(seam.lon).toBeCloseTo(MID.lon, 6);

    // Complete-route metadata + no incomplete flags.
    expect(full.model).toBe('GFS');
    expect(full.usedCurrents).toBe(false);
    expect(full.polarId).toBe('uniform');
    expect(full.incomplete).toBeUndefined();
    expect(full.incompleteVia).toBeUndefined();
  });

  it('enforces maxHours as a TOTAL budget across segments', () => {
    const seg0 = plan(baseInput({ end: MID }));
    const seg1 = plan(baseInput({ start: MID, departure: seg0.end }));
    const t0h = (seg0.end - seg0.start) / 3600;
    const t1h = (seg1.end - seg1.start) / 3600;

    // Budget below the first segment ⇒ fails at via index 0.
    const r0 = planVia(baseInput({ options: { avoidLand: false, maxHours: t0h / 2 } }), [MID]);
    expect(r0.incomplete).toBe(true);
    expect(r0.incompleteVia).toBe(0);

    // Budget covers segment 0 but not segment 1 ⇒ fails at via index 1.
    // (Proves the budget is shared, not per-segment.)
    const r1 = planVia(baseInput({ options: { avoidLand: false, maxHours: t0h + t1h / 2 } }), [
      MID,
    ]);
    expect(r1.incomplete).toBe(true);
    expect(r1.incompleteVia).toBe(1);
  });

  it('chains three segments, deduping each seam', () => {
    const seg0 = plan(baseInput({ end: MID }));
    const seg1 = plan(baseInput({ start: MID, end: MID2, departure: seg0.end }));
    const seg2 = plan(baseInput({ start: MID2, departure: seg1.end }));
    const full = planVia(baseInput(), [MID, MID2]);

    expect(full.end).toBe(seg2.end);
    expect(full.distance).toBeCloseTo(seg0.distance + seg1.distance + seg2.distance, 0);
    // Two seams deduped ⇒ minus 2 legs.
    expect(full.legs.length).toBe(seg0.legs.length + seg1.legs.length + seg2.legs.length - 2);
    expect(full.incomplete).toBeUndefined();
  });
});
