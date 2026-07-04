import { describe, it, expect } from 'vitest';
import { TripDetector, type TripEvent, type TripFixInput } from './detector.js';

const KN_TO_MPS = 0.514444;
const M_PER_DEG_LAT = 111_320;

/**
 * Builds synthetic 1 Hz traces with a flat-earth position integrator —
 * close enough to haversine at these scales for ±1% assertions.
 */
class TraceBuilder {
  private tMs: number;
  private lat: number;
  private lon: number;
  readonly samples: TripFixInput[] = [];

  constructor(startMs = 1_700_000_000_000, lat = 41.5, lon = -71.3) {
    this.tMs = startMs;
    this.lat = lat;
    this.lon = lon;
  }

  get lastT(): number {
    return this.tMs - 1000;
  }

  /** Straight leg at constant SOG/bearing, one sample per second. */
  leg(durS: number, sogKn: number, bearingDeg = 0): this {
    const mps = sogKn * KN_TO_MPS;
    const brg = (bearingDeg * Math.PI) / 180;
    for (let i = 0; i < durS; i += 1) {
      this.samples.push({ tMs: this.tMs, lat: this.lat, lon: this.lon, sogKn });
      this.lat += (mps * Math.cos(brg)) / M_PER_DEG_LAT;
      this.lon += (mps * Math.sin(brg)) / (M_PER_DEG_LAT * Math.cos((this.lat * Math.PI) / 180));
      this.tMs += 1000;
    }
    return this;
  }

  /** Anchor swing: deterministic position jitter within radiusM, cycling SOG values. */
  swing(durS: number, radiusM: number, sogsKn: number[]): this {
    const baseLat = this.lat;
    const baseLon = this.lon;
    for (let i = 0; i < durS; i += 1) {
      const ang = (i * 0.7) % (2 * Math.PI);
      const r = radiusM * (0.3 + 0.7 * (((i * 13) % 10) / 10));
      const lat = baseLat + (r * Math.cos(ang)) / M_PER_DEG_LAT;
      const lon =
        baseLon + (r * Math.sin(ang)) / (M_PER_DEG_LAT * Math.cos((baseLat * Math.PI) / 180));
      this.samples.push({ tMs: this.tMs, lat, lon, sogKn: sogsKn[i % sogsKn.length]! });
      this.tMs += 1000;
    }
    this.lat = baseLat;
    this.lon = baseLon;
    return this;
  }

  /** Skip time without emitting samples (a reception gap). */
  gap(durS: number): this {
    this.tMs += durS * 1000;
    return this;
  }

  /** Inject a single glitch fix offset east by offsetM, then keep going. */
  glitch(offsetM: number, sogKn: number): this {
    const gLon = this.lon + offsetM / (M_PER_DEG_LAT * Math.cos((this.lat * Math.PI) / 180));
    this.samples.push({ tMs: this.tMs, lat: this.lat, lon: gLon, sogKn });
    this.tMs += 1000;
    return this;
  }
}

function feedAll(detector: TripDetector, samples: TripFixInput[]): TripEvent[] {
  return samples.flatMap((s) => detector.feed(s));
}

describe('TripDetector', () => {
  it('marina departure → sail → anchor produces exactly one trip with backdated end', () => {
    const trace = new TraceBuilder()
      .leg(120, 0.3) // moored at the dock
      .leg(1800, 6, 0) // sail north at 6 kn
      .leg(900, 0.3); // anchored (creep below moored threshold)
    const firstFastT = trace.samples[120]!.tMs;
    const firstSlowT = trace.samples[120 + 1800]!.tMs;

    const events = feedAll(new TripDetector(), trace.samples);
    expect(events.map((e) => e.type)).toEqual(['start', 'end']);

    const start = events[0]! as Extract<TripEvent, { type: 'start' }>;
    expect(start.tMs).toBe(firstFastT); // backdated to when the boat started moving

    const end = events[1]! as Extract<TripEvent, { type: 'end' }>;
    // End backdated to the first slow fix, not 600 s later when the hold expired.
    expect(end.tMs).toBe(firstSlowT);

    const fastDistM = 1800 * 6 * KN_TO_MPS; // ≈ 5556 m
    expect(end.summary.distanceM).toBeGreaterThan(fastDistM * 0.98);
    // Anchor creep during the slow window (~140 m) must be excluded.
    expect(end.summary.distanceM).toBeLessThan(fastDistM + 60);
    expect(end.summary.durationS).toBeCloseTo(1800, 0);
    expect(end.summary.maxSogKn).toBe(6);
    expect(end.summary.avgSogKn).toBeGreaterThan(5.8);
    expect(end.summary.avgSogKn).toBeLessThan(6.2);
    expect(end.summary.samples).toBeGreaterThan(1700);
  });

  it('hours of anchor swing (30 m jitter, SOG 0.2–0.8 kn) produces no trip', () => {
    const trace = new TraceBuilder().swing(3 * 3600, 30, [0.2, 0.5, 0.8, 0.4, 0.7, 0.3]);
    const events = feedAll(new TripDetector(), trace.samples);
    expect(events).toEqual([]);
  });

  it('a 30 s SOG spike does not start a trip', () => {
    const trace = new TraceBuilder()
      .leg(120, 0.2)
      .leg(30, 3, 90) // brief surge — under the 60 s hold
      .leg(300, 0.2);
    const events = feedAll(new TripDetector(), trace.samples);
    expect(events).toEqual([]);
  });

  it('a sample gap force-closes the open trip at the last good fix', () => {
    const trace = new TraceBuilder().leg(120, 0.3).leg(1800, 6, 0);
    const lastGoodT = trace.lastT;
    trace.gap(1000).leg(60, 0.2);
    const events = feedAll(new TripDetector(), trace.samples);
    expect(events.map((e) => e.type)).toEqual(['start', 'end']);
    const end = events[1]! as Extract<TripEvent, { type: 'end' }>;
    expect(end.tMs).toBe(lastGoodT);
    const fastDistM = 1800 * 6 * KN_TO_MPS;
    expect(end.summary.distanceM).toBeGreaterThan(fastDistM * 0.98);
    expect(end.summary.distanceM).toBeLessThan(fastDistM * 1.02);
  });

  it('rejects a GPS glitch fix from the distance accumulation', () => {
    const clean = new TraceBuilder().leg(120, 0.3).leg(900, 6, 0).leg(900, 6, 0).leg(700, 0.2);
    const glitched = new TraceBuilder()
      .leg(120, 0.3)
      .leg(900, 6, 0)
      .glitch(1000, 6) // single fix 1000 m east, 1 s after the previous
      .leg(900, 6, 0)
      .leg(700, 0.2);

    const cleanEnd = feedAll(new TripDetector(), clean.samples).find((e) => e.type === 'end') as
      | Extract<TripEvent, { type: 'end' }>
      | undefined;
    const glitchEnd = feedAll(new TripDetector(), glitched.samples).find(
      (e) => e.type === 'end',
    ) as Extract<TripEvent, { type: 'end' }> | undefined;
    expect(cleanEnd).toBeDefined();
    expect(glitchEnd).toBeDefined();
    // Without rejection the glitch adds ~2000 m (out and back).
    expect(Math.abs(glitchEnd!.summary.distanceM - cleanEnd!.summary.distanceM)).toBeLessThan(20);
  });

  it('discards trips shorter than minTripM (emits discard, no end)', () => {
    const trace = new TraceBuilder()
      .leg(120, 0.2)
      .leg(120, 2, 0) // ≈ 123 m — under the 370 m floor
      .leg(700, 0.2);
    const events = feedAll(new TripDetector(), trace.samples);
    expect(events.map((e) => e.type)).toEqual(['start', 'discard']);
  });

  it('null SOG keeps an open trip open and still accumulates distance', () => {
    const trace = new TraceBuilder().leg(120, 0.3).leg(600, 6, 0).leg(300, 6, 0);
    // Last 300 s become position-only fixes (no SOG), still moving.
    const samples = trace.samples.map((s, i) =>
      i >= 720 ? { ...s, sogKn: null } : s,
    ) as TripFixInput[];
    const detector = new TripDetector();
    const events = feedAll(detector, samples);
    expect(events.map((e) => e.type)).toEqual(['start']);
    const snap = detector.snapshot(samples.at(-1)!.tMs);
    expect(snap.state).toBe('underway');
    expect(snap.liveDistanceM).toBeGreaterThan(850 * 6 * KN_TO_MPS);
  });

  it('close() force-closes an open trip at the last accepted fix', () => {
    const trace = new TraceBuilder().leg(120, 0.3).leg(1800, 6, 0);
    const detector = new TripDetector();
    const events = feedAll(detector, trace.samples);
    expect(events.map((e) => e.type)).toEqual(['start']);
    const closed = detector.close();
    expect(closed.map((e) => e.type)).toEqual(['end']);
    const end = closed[0]! as Extract<TripEvent, { type: 'end' }>;
    expect(end.tMs).toBe(trace.lastT);
    expect(detector.snapshot(trace.lastT).state).toBe('moored');
    // Idempotent: nothing further to close.
    expect(detector.close()).toEqual([]);
  });

  it('snapshot reports moored → underway transitions', () => {
    const detector = new TripDetector();
    const trace = new TraceBuilder().leg(60, 0.2);
    feedAll(detector, trace.samples);
    const t0 = trace.samples[0]!.tMs;
    expect(detector.snapshot(t0 + 60_000)).toEqual({
      state: 'moored',
      sinceMs: t0,
      liveDistanceM: 0,
      liveDurationS: 60,
    });
    const sail = new TraceBuilder(trace.samples.at(-1)!.tMs + 1000).leg(120, 6, 0);
    feedAll(detector, sail.samples);
    const snap = detector.snapshot(sail.lastT);
    expect(snap.state).toBe('underway');
    expect(snap.sinceMs).toBe(sail.samples[0]!.tMs);
    expect(snap.liveDistanceM).toBeGreaterThan(0);
  });
});
