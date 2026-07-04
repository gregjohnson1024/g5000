import { describe, it, expect } from 'vitest';
import { computeTripStats, type TripStatsInput } from './trip-stats';

const HOUR_MS = 3600_000;

/** 2026-07-01T00:00:00Z. */
const T0 = Date.UTC(2026, 6, 1);

function trip(over: Partial<TripStatsInput> = {}): TripStatsInput {
  return {
    startMs: T0,
    endMs: T0 + 2 * HOUR_MS,
    distanceM: 1852 * 10, // 10 NM
    durationS: 7200,
    maxSogKn: 6.5,
    mode: 'sail',
    stayKind: 'unknown',
    ...over,
  };
}

describe('computeTripStats', () => {
  it('returns zeroed stats for an empty array', () => {
    const s = computeTripStats([]);
    expect(s.totalTrips).toBe(0);
    expect(s.totalNm).toBe(0);
    expect(s.totalUnderwayS).toBe(0);
    expect(s.longestTrip).toBeNull();
    expect(s.maxSogKn).toBeNull();
    expect(s.nightsAtAnchor).toBe(0);
    expect(s.hoursAtAnchor).toBe(0);
    expect(s.hoursMoored).toBe(0);
    expect(s.modeBreakdown).toEqual({
      sail: { count: 0, nm: 0 },
      motor: { count: 0, nm: 0 },
      mixed: { count: 0, nm: 0 },
      unknown: { count: 0, nm: 0 },
    });
    expect(s.perMonth).toEqual([]);
  });

  it('handles a single trip (its trailing stay is unclosed)', () => {
    const s = computeTripStats([trip({ stayKind: 'anchor' })]);
    expect(s.totalTrips).toBe(1);
    expect(s.totalNm).toBeCloseTo(10);
    expect(s.totalUnderwayS).toBe(7200);
    expect(s.longestTrip).toEqual({ nm: 10, durationS: 7200, startMs: T0 });
    expect(s.maxSogKn).toBe(6.5);
    // No next trip: the anchor stay never closed, so no hours and no nights.
    expect(s.hoursAtAnchor).toBe(0);
    expect(s.hoursMoored).toBe(0);
    expect(s.nightsAtAnchor).toBe(0);
    expect(s.modeBreakdown.sail).toEqual({ count: 1, nm: 10 });
    expect(s.perMonth).toEqual([{ ym: '2026-07', nm: 10, trips: 1 }]);
  });

  it('aggregates totals, longest trip and max SOG across trips', () => {
    const a = trip({ startMs: T0, endMs: T0 + 2 * HOUR_MS, maxSogKn: 6 });
    const b = trip({
      startMs: T0 + 24 * HOUR_MS,
      endMs: T0 + 30 * HOUR_MS,
      distanceM: 1852 * 42,
      durationS: 6 * 3600,
      maxSogKn: 9.1,
      mode: 'motor',
    });
    const s = computeTripStats([a, b]);
    expect(s.totalTrips).toBe(2);
    expect(s.totalNm).toBeCloseTo(52);
    expect(s.totalUnderwayS).toBe(7200 + 6 * 3600);
    expect(s.longestTrip).toEqual({ nm: 42, durationS: 6 * 3600, startMs: b.startMs });
    expect(s.maxSogKn).toBe(9.1);
    expect(s.modeBreakdown.sail).toEqual({ count: 1, nm: 10 });
    expect(s.modeBreakdown.motor).toEqual({ count: 1, nm: 42 });
  });

  it('is order-independent (sorts by startMs internally)', () => {
    const a = trip({ startMs: T0, endMs: T0 + HOUR_MS, stayKind: 'anchor' });
    const b = trip({ startMs: T0 + 12 * HOUR_MS, endMs: T0 + 14 * HOUR_MS });
    expect(computeTripStats([b, a])).toEqual(computeTripStats([a, b]));
    // Stay a→b is 11 h at anchor, counted despite the shuffled input.
    expect(computeTripStats([b, a]).hoursAtAnchor).toBeCloseTo(11);
  });

  it('counts anchor stays >= 6 h as nights; shorter ones only accrue hours', () => {
    const a = trip({ startMs: T0, endMs: T0 + HOUR_MS, stayKind: 'anchor' });
    // 10 h anchor stay → 1 night.
    const b = trip({
      startMs: T0 + 11 * HOUR_MS,
      endMs: T0 + 12 * HOUR_MS,
      stayKind: 'anchor',
    });
    // 3 h anchor stay → hours only, no night.
    const c = trip({ startMs: T0 + 15 * HOUR_MS, endMs: T0 + 16 * HOUR_MS });
    const s = computeTripStats([a, b, c]);
    expect(s.nightsAtAnchor).toBe(1);
    expect(s.hoursAtAnchor).toBeCloseTo(13);
    expect(s.hoursMoored).toBe(0);
  });

  it('books non-anchor stays as moored hours', () => {
    const a = trip({ startMs: T0, endMs: T0 + HOUR_MS, stayKind: 'unknown' });
    const b = trip({ startMs: T0 + 9 * HOUR_MS, endMs: T0 + 10 * HOUR_MS });
    const s = computeTripStats([a, b]);
    expect(s.hoursMoored).toBeCloseTo(8);
    expect(s.hoursAtAnchor).toBe(0);
    expect(s.nightsAtAnchor).toBe(0);
  });

  it('ignores non-positive stay gaps (overlapping or touching trips)', () => {
    const a = trip({ startMs: T0, endMs: T0 + 2 * HOUR_MS, stayKind: 'anchor' });
    const b = trip({ startMs: T0 + 2 * HOUR_MS, endMs: T0 + 3 * HOUR_MS });
    const s = computeTripStats([a, b]);
    expect(s.hoursAtAnchor).toBe(0);
    expect(s.hoursMoored).toBe(0);
  });

  it('buckets per UTC month, ascending', () => {
    const jun = trip({
      startMs: Date.UTC(2026, 5, 20),
      endMs: Date.UTC(2026, 5, 20) + 2 * HOUR_MS,
      distanceM: 1852 * 5,
    });
    const jul1 = trip({ startMs: Date.UTC(2026, 6, 2), endMs: Date.UTC(2026, 6, 2) + HOUR_MS });
    const jul2 = trip({
      startMs: Date.UTC(2026, 6, 9),
      endMs: Date.UTC(2026, 6, 9) + HOUR_MS,
      distanceM: 1852 * 20,
    });
    const s = computeTripStats([jul2, jun, jul1]);
    expect(s.perMonth).toEqual([
      { ym: '2026-06', nm: 5, trips: 1 },
      { ym: '2026-07', nm: 30, trips: 2 },
    ]);
  });

  it('tallies the mode breakdown across all four modes', () => {
    const mk = (i: number, mode: TripStatsInput['mode'], nm: number): TripStatsInput =>
      trip({
        startMs: T0 + i * 24 * HOUR_MS,
        endMs: T0 + i * 24 * HOUR_MS + HOUR_MS,
        mode,
        distanceM: 1852 * nm,
      });
    const s = computeTripStats([
      mk(0, 'sail', 10),
      mk(1, 'sail', 4),
      mk(2, 'motor', 7),
      mk(3, 'mixed', 3),
      mk(4, 'unknown', 1),
    ]);
    expect(s.modeBreakdown).toEqual({
      sail: { count: 2, nm: 14 },
      motor: { count: 1, nm: 7 },
      mixed: { count: 1, nm: 3 },
      unknown: { count: 1, nm: 1 },
    });
  });
});
