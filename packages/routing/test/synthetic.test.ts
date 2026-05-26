import { describe, it, expect } from 'vitest';
import type { WindField, CurrentField } from '@g5000/grib';
import type { PolarTable } from '@g5000/db';
import type { Coastline } from '@g5000/coastline';
import { DEFAULT_POLARS } from '@g5000/db';
import { plan, greatCircleDistance, greatCircleBearing } from '../src/index.js';
import type { LatLon, Route, PlanOptions } from '../src/index.js';

/**
 * Synthetic routing harness.
 *
 * Isolates the search algorithm (heading fan + bearing-bucket prune) from
 * real GRIB data and the sailing polar. With a *uniform* polar — boat speed
 * independent of TWA/TWS — the optimal route between two points over open
 * water is a straight line, and ETA is analytically `gc_distance / speed`.
 * Any deviation (ratio ≫ 1, large cross-track, or `incomplete`) is a defect
 * in the planner's search, not in the physics inputs.
 *
 * Two ways to express "uniform in all directions" are exercised and MUST
 * agree:
 *   - `motor: true` + `motorSpeed` — bypasses `interpolatePolarSpeed`.
 *   - a flat `PolarTable` (every cell = motorSpeed) — goes through the real
 *     `propagate → interpolatePolarSpeed` path.
 * If those two diverge, the bug is in the polar-lookup leg of `propagate`.
 */

const M_PER_NM = 1852;
const R_EARTH = 6371008.8;
const MOTOR_MS = 2.572; // 5 kn

// avoidLand:false ⇒ coastline is never consulted. Stub it.
const NO_COAST = { level: 'i', polygons: [], index: undefined } as unknown as Coastline;

// Flat polar: constant MOTOR_MS at every (TWS, TWA). Out-of-range inputs are
// clamped by interpolatePolarSpeed, so two coarse bins suffice.
const FLAT_POLAR: PolarTable = {
  twsBins: [0, 100],
  twaBins: [0, Math.PI],
  boatSpeed: [
    [MOTOR_MS, MOTOR_MS],
    [MOTOR_MS, MOTOR_MS],
  ],
};

const DEPARTURE = 1_768_000_000; // arbitrary fixed 2026 epoch (seconds)

interface WindSpec {
  start: LatLon;
  end: LatLon;
  hours: number;
  /** Eastward / northward wind components (m/s) at a point. */
  uv: (lat: number, lon: number) => { u: number; v: number };
  /** Degrees of buffer added around the start/end envelope. */
  bufferDeg?: number;
  stepDeg?: number;
}

/** Build a regular-grid WindField spanning the start/end envelope + buffer. */
function makeWind(s: WindSpec): WindField {
  const buf = s.bufferDeg ?? 10;
  const step = s.stepDeg ?? 1;
  const latMin = Math.min(s.start.lat, s.end.lat) - buf;
  const latMax = Math.max(s.start.lat, s.end.lat) + buf;
  const lonMin = Math.min(s.start.lon, s.end.lon) - buf;
  const lonMax = Math.max(s.start.lon, s.end.lon) + buf;

  const lats: number[] = [];
  for (let y = latMin; y <= latMax + 1e-9; y += step) lats.push(y);
  const lons: number[] = [];
  for (let x = lonMin; x <= lonMax + 1e-9; x += step) lons.push(x);
  const times = [DEPARTURE, DEPARTURE + s.hours * 3600];

  const u = times.map(() => lats.map((la) => lons.map((lo) => s.uv(la, lo).u)));
  const v = times.map(() => lats.map((la) => lons.map((lo) => s.uv(la, lo).v)));

  return { lats, lons, times, u, v, source: 'GFS', runTime: DEPARTURE };
}

/** Signed cross-track distance (NM) of p from the start→end great circle. */
function crossTrackNm(start: LatLon, end: LatLon, p: LatLon): number {
  const d13 = greatCircleDistance(start, p) / R_EARTH;
  const th13 = greatCircleBearing(start, p);
  const th12 = greatCircleBearing(start, end);
  const xt = Math.asin(Math.sin(d13) * Math.sin(th13 - th12)) * R_EARTH;
  return Math.abs(xt) / M_PER_NM;
}

interface Metrics {
  complete: boolean;
  reason: string;
  legs: number;
  gcNm: number;
  routeNm: number;
  ratio: number;
  maxXtNm: number;
  etaHrs: number;
  idealHrs: number;
}

function measure(start: LatLon, end: LatLon, r: Route): Metrics {
  const gcNm = greatCircleDistance(start, end) / M_PER_NM;
  const routeNm = r.distance / M_PER_NM;
  let maxXt = 0;
  for (const leg of r.legs) {
    maxXt = Math.max(maxXt, crossTrackNm(start, end, { lat: leg.lat, lon: leg.lon }));
  }
  return {
    complete: !r.incomplete,
    reason: r.reason ?? 'reached',
    legs: r.legs.length,
    gcNm,
    routeNm,
    ratio: routeNm / gcNm,
    maxXtNm: maxXt,
    etaHrs: (r.end - r.start) / 3600,
    idealHrs: (gcNm * M_PER_NM) / MOTOR_MS / 3600,
  };
}

function fmt(m: Metrics): string {
  return [
    `${m.complete ? 'OK ' : 'INC'}/${m.reason}`.padEnd(22),
    `legs=${String(m.legs).padStart(4)}`,
    `gc=${m.gcNm.toFixed(0).padStart(4)}nm`,
    `route=${m.routeNm.toFixed(0).padStart(5)}nm`,
    `ratio=${m.ratio.toFixed(3)}`,
    `maxXT=${m.maxXtNm.toFixed(1).padStart(6)}nm`,
    `eta=${m.etaHrs.toFixed(1).padStart(6)}h`,
    `ideal=${m.idealHrs.toFixed(1).padStart(6)}h`,
  ].join('  ');
}

interface Scenario {
  name: string;
  start: LatLon;
  end: LatLon;
  wind: WindSpec;
  maxHours: number;
}

const SCENARIOS: Scenario[] = [
  {
    name: 'A. due east, beam wind (from S)',
    start: { lat: 35, lon: -60 },
    end: { lat: 35, lon: -50 },
    maxHours: 168,
    wind: {
      start: { lat: 35, lon: -60 },
      end: { lat: 35, lon: -50 },
      hours: 168,
      uv: () => ({ u: 0, v: 8 }),
    },
  },
  {
    name: 'B. due east, head/tail wind (from W)',
    start: { lat: 35, lon: -60 },
    end: { lat: 35, lon: -50 },
    maxHours: 168,
    wind: {
      start: { lat: 35, lon: -60 },
      end: { lat: 35, lon: -50 },
      hours: 168,
      uv: () => ({ u: 8, v: 0 }),
    },
  },
  {
    name: 'C. NW diagonal (Bermuda→Newport coords)',
    start: { lat: 32.45, lon: -64.65 },
    end: { lat: 41.3, lon: -71.2 },
    maxHours: 168,
    wind: {
      start: { lat: 32.45, lon: -64.65 },
      end: { lat: 41.3, lon: -71.2 },
      hours: 168,
      uv: () => ({ u: -6, v: 4 }),
    },
  },
  {
    name: 'D. NW diagonal, smooth wind gradient',
    start: { lat: 32.45, lon: -64.65 },
    end: { lat: 41.3, lon: -71.2 },
    maxHours: 168,
    wind: {
      start: { lat: 32.45, lon: -64.65 },
      end: { lat: 41.3, lon: -71.2 },
      hours: 168,
      // Smoothly varying field: speed and direction drift with latitude.
      uv: (lat) => ({ u: -6 + 0.4 * (lat - 32), v: 4 - 0.2 * (lat - 32) }),
    },
  },
];

describe('synthetic routing: uniform polar ⇒ straight line', () => {
  for (const sc of SCENARIOS) {
    it(sc.name, () => {
      const wind = makeWind(sc.wind);
      const baseOpts: PlanOptions = {
        maxHours: sc.maxHours,
        avoidLand: false,
        captureIsochrones: false,
      };

      const motor = plan({
        start: sc.start,
        end: sc.end,
        departure: DEPARTURE,
        wind,
        polar: FLAT_POLAR,
        polarId: 'flat',
        coastline: NO_COAST,
        options: { ...baseOpts, motor: true, motorSpeed: MOTOR_MS },
      });

      const flat = plan({
        start: sc.start,
        end: sc.end,
        departure: DEPARTURE,
        wind,
        polar: FLAT_POLAR,
        polarId: 'flat',
        coastline: NO_COAST,
        options: { ...baseOpts, motor: false },
      });

      const mm = measure(sc.start, sc.end, motor);
      const fm = measure(sc.start, sc.end, flat);

      console.log(`\n${sc.name}`);
      console.log(`  motor : ${fmt(mm)}`);
      console.log(`  flat  : ${fmt(fm)}`);

      // Invariant: motor mode and a flat polar describe the same boat, so
      // they must produce the same route. Divergence localises a bug to the
      // polar-lookup leg of propagate().
      expect(fm.legs).toBe(mm.legs);
      expect(fm.routeNm).toBeCloseTo(mm.routeNm, 3);
      expect(fm.complete).toBe(mm.complete);
    });
  }
});

/**
 * Real (angle-dependent) polar under controlled *uniform* wind. The wind is
 * still trivial — constant everywhere — so the ONLY source of routing
 * complexity is the polar's TWA dependence. This exercises the case the
 * progress-based prune was built to fix: when the optimal route must leave
 * the bearing-to-destination corridor (beating upwind, deep running), the
 * planner must still converge on the destination.
 *
 * Beam reach is the control (no tactical detour needed). Upwind and downwind
 * are the stressors: both require tacking / gybing off the rhumb. With the
 * progress prune (prune.ts: closest-to-destination per bearing-from-start
 * bucket) all three complete. The old furthest-from-start prune left upwind
 * and downwind `incomplete` — the frontier overshot the destination and the
 * converging tacks were pruned every step (see prune.ts header).
 */
describe('synthetic routing: real polar, uniform wind', () => {
  const START: LatLon = { lat: 35, lon: -60 };
  const END: LatLon = { lat: 42, lon: -60 }; // due north ~420 NM
  const TWS = 8; // m/s ≈ 15.5 kn

  // Wind described by the direction it blows TOWARD (u east, v north).
  // `maxRatio` bounds route/great-circle distance: ~1 for the reach, ~1.45
  // for a 45° upwind beat, modest for the downwind gybe.
  const cases: Array<{ name: string; uv: { u: number; v: number }; maxRatio: number }> = [
    { name: 'beam reach (wind from E)', uv: { u: -TWS, v: 0 }, maxRatio: 1.05 },
    { name: 'dead upwind (wind from N)', uv: { u: 0, v: -TWS }, maxRatio: 1.5 },
    { name: 'dead downwind (wind from S)', uv: { u: 0, v: TWS }, maxRatio: 1.2 },
  ];

  for (const c of cases) {
    it(c.name, () => {
      const wind = makeWind({ start: START, end: END, hours: 168, uv: () => c.uv });
      const r = plan({
        start: START,
        end: END,
        departure: DEPARTURE,
        wind,
        polar: DEFAULT_POLARS,
        polarId: 'default',
        coastline: NO_COAST,
        options: { maxHours: 168, avoidLand: false },
      });
      const m = measure(START, END, r);
      console.log(`\n${c.name}\n  ${fmt(m)}`);
      expect(m.legs).toBeGreaterThan(1);
      expect(m.complete).toBe(true);
      expect(m.ratio).toBeLessThan(c.maxRatio);
      if (c.name.startsWith('dead upwind')) {
        // A real beat — must be meaningfully longer than the rhumb line.
        expect(m.ratio).toBeGreaterThan(1.3);
      }
    });
  }
});

/**
 * Zero wind + a CurrentField, uniform polar (motor). Wind is identically
 * zero everywhere, so the ONLY thing shaping the ground track is the
 * current vector added in propagate(): vGround = boatThroughWater + current.
 * This exercises the `useCurrents` path (off by default, lightly tested) and
 * answers two distinct questions:
 *
 *   1. Vector math + in-corridor search — does the planner add/subtract
 *      along-track current correctly, and does it find the CRAB angle that
 *      holds a straight ground track against a beam set? (It does, exactly:
 *      ETAs match the analytic ideal and cross-track stays ~0, even for a
 *      51° crab.)
 *   2. Lateral current structure — does it detour toward a favourable
 *      current band offset from the rhumb line? (It does NOT. The route is
 *      byte-for-byte the no-current baseline.) This is the SAME prune
 *      starvation as the upwind case above: any optimum that requires
 *      leaving the bearing-to-destination corridor is discarded. The fix is
 *      identical — prune on progress-to-destination, not distance-from-start.
 */
describe('synthetic routing: currents, zero wind', () => {
  const START: LatLon = { lat: 35, lon: -60 };
  const END: LatLon = { lat: 42, lon: -60 }; // due north ~420 NM
  const GC_M = greatCircleDistance(START, END);

  const ZERO_WIND = makeWind({ start: START, end: END, hours: 168, uv: () => ({ u: 0, v: 0 }) });

  function makeCurrent(uv: (lat: number, lon: number) => { u: number; v: number }): CurrentField {
    const w = makeWind({ start: START, end: END, hours: 168, uv });
    return { ...w, source: 'CMEMS' };
  }

  function planWithCurrent(cur: CurrentField): Route {
    return plan({
      start: START,
      end: END,
      departure: DEPARTURE,
      wind: ZERO_WIND,
      polar: FLAT_POLAR,
      polarId: 'flat',
      coastline: NO_COAST,
      currents: cur,
      options: {
        maxHours: 168,
        avoidLand: false,
        useCurrents: true,
        motor: true,
        motorSpeed: MOTOR_MS,
      },
    });
  }

  it('along-track current adds/subtracts speed, track stays straight', () => {
    const fav = measure(START, END, planWithCurrent(makeCurrent(() => ({ u: 0, v: 1.0 }))));
    const adv = measure(START, END, planWithCurrent(makeCurrent(() => ({ u: 0, v: -1.0 }))));
    console.log(`\nalong-track favourable: ${fmt(fav)}\nalong-track adverse   : ${fmt(adv)}`);
    expect(fav.complete && adv.complete).toBe(true);
    expect(fav.maxXtNm).toBeLessThan(1);
    expect(adv.maxXtNm).toBeLessThan(1);
    // ETA tracks gc / (motorSpeed ± current) to within a step.
    expect(fav.etaHrs).toBeCloseTo(GC_M / (MOTOR_MS + 1.0) / 3600, 0);
    expect(adv.etaHrs).toBeCloseTo(GC_M / (MOTOR_MS - 1.0) / 3600, 0);
  });

  it('finds the crab angle against a beam set (straight ground track)', () => {
    const weak = measure(START, END, planWithCurrent(makeCurrent(() => ({ u: 1.0, v: 0 }))));
    const strong = measure(START, END, planWithCurrent(makeCurrent(() => ({ u: 2.0, v: 0 }))));
    console.log(`\ncross-set 1 m/s: ${fmt(weak)}\ncross-set 2 m/s: ${fmt(strong)}`);
    // The boat must crab upstream; a correct solver holds a straight track.
    expect(weak.complete && strong.complete).toBe(true);
    expect(weak.maxXtNm).toBeLessThan(2);
    expect(strong.maxXtNm).toBeLessThan(2);
    // Along-track speed = sqrt(bsp² − cross²); ETA matches that, not gc/bsp.
    expect(weak.etaHrs).toBeCloseTo(GC_M / Math.sqrt(MOTOR_MS ** 2 - 1.0 ** 2) / 3600, 0);
    expect(strong.etaHrs).toBeCloseTo(GC_M / Math.sqrt(MOTOR_MS ** 2 - 2.0 ** 2) / 3600, 0);
  });

  it('detours into a favourable current band offset from the rhumb', () => {
    // Strong +4 kn northward jet 2–4° east of the due-north rhumb line.
    const jet = measure(
      START,
      END,
      planWithCurrent(
        makeCurrent((_lat, lon) => (lon >= -58 && lon <= -56 ? { u: 0, v: 2.0 } : { u: 0, v: 0 })),
      ),
    );
    const baseline = measure(START, END, planWithCurrent(makeCurrent(() => ({ u: 0, v: 0 }))));
    console.log(`\njet band : ${fmt(jet)}\nbaseline : ${fmt(baseline)}`);
    // With the progress-based prune the planner bends EAST into the favourable
    // band, rides it north, and finishes faster than the no-current straight
    // line — exploiting lateral current structure the old prune was blind to.
    // (The old furthest-from-start prune produced a route byte-identical to
    // baseline: maxXT ~0, no time saved.)
    expect(jet.maxXtNm).toBeGreaterThan(20); // clear eastward detour
    expect(jet.etaHrs).toBeLessThan(baseline.etaHrs); // and it pays off
  });
});
