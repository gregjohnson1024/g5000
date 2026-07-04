/**
 * Pure aggregate statistics over an array of trips (see packages/db trips).
 *
 * A "stay" is the gap between one trip's end and the NEXT (chronologically
 * later) trip's start; its `stayKind` is the one recorded on the trip that
 * BEGAN it. The stay after the final trip is unclosed (no next trip) and is
 * excluded from all stay-based aggregates.
 *
 * "Nights at anchor" is deliberately simple: any closed stay >= 6 h whose
 * stayKind is 'anchor' counts as one night.
 */

const M_PER_NM = 1852;
const NIGHT_MIN_S = 6 * 3600;

export type TripStatsMode = 'sail' | 'motor' | 'mixed' | 'unknown';

/** Structural subset of the db Trip row that the stats need. */
export interface TripStatsInput {
  /** Epoch ms. */
  startMs: number;
  /** Epoch ms. */
  endMs: number;
  distanceM: number;
  durationS: number;
  maxSogKn: number;
  mode: TripStatsMode;
  stayKind: 'anchor' | 'unknown';
}

export interface ModeBucket {
  count: number;
  nm: number;
}

export interface MonthBucket {
  /** UTC year-month, e.g. '2026-07'. */
  ym: string;
  nm: number;
  trips: number;
}

export interface TripStats {
  totalTrips: number;
  totalNm: number;
  totalUnderwayS: number;
  /** Longest trip by distance; null when there are no trips. */
  longestTrip: { nm: number; durationS: number; startMs: number } | null;
  /** Fastest recorded SOG across all trips; null when there are no trips. */
  maxSogKn: number | null;
  nightsAtAnchor: number;
  hoursAtAnchor: number;
  hoursMoored: number;
  modeBreakdown: Record<TripStatsMode, ModeBucket>;
  /** Buckets by trip startMs (UTC month), ascending. */
  perMonth: MonthBucket[];
}

const utcYm = (ms: number): string => new Date(ms).toISOString().slice(0, 7);

export function computeTripStats(trips: readonly TripStatsInput[]): TripStats {
  const sorted = [...trips].sort((a, b) => a.startMs - b.startMs);

  const modeBreakdown: Record<TripStatsMode, ModeBucket> = {
    sail: { count: 0, nm: 0 },
    motor: { count: 0, nm: 0 },
    mixed: { count: 0, nm: 0 },
    unknown: { count: 0, nm: 0 },
  };
  const perMonthMap = new Map<string, MonthBucket>();

  let totalNm = 0;
  let totalUnderwayS = 0;
  let longest: { nm: number; durationS: number; startMs: number } | null = null;
  let maxSogKn: number | null = null;
  let nightsAtAnchor = 0;
  let hoursAtAnchor = 0;
  let hoursMoored = 0;

  for (let i = 0; i < sorted.length; i++) {
    const trip = sorted[i]!;
    const nm = trip.distanceM / M_PER_NM;
    totalNm += nm;
    totalUnderwayS += trip.durationS;
    if (longest === null || nm > longest.nm) {
      longest = { nm, durationS: trip.durationS, startMs: trip.startMs };
    }
    if (maxSogKn === null || trip.maxSogKn > maxSogKn) maxSogKn = trip.maxSogKn;

    const bucket = modeBreakdown[trip.mode];
    bucket.count += 1;
    bucket.nm += nm;

    const ym = utcYm(trip.startMs);
    const month = perMonthMap.get(ym) ?? { ym, nm: 0, trips: 0 };
    month.nm += nm;
    month.trips += 1;
    perMonthMap.set(ym, month);

    // Closed stay: gap to the next chronological trip. The final trip's stay
    // is unclosed and contributes nothing.
    const next = sorted[i + 1];
    if (next !== undefined) {
      const stayS = (next.startMs - trip.endMs) / 1000;
      if (stayS > 0) {
        if (trip.stayKind === 'anchor') {
          hoursAtAnchor += stayS / 3600;
          if (stayS >= NIGHT_MIN_S) nightsAtAnchor += 1;
        } else {
          hoursMoored += stayS / 3600;
        }
      }
    }
  }

  return {
    totalTrips: sorted.length,
    totalNm,
    totalUnderwayS,
    longestTrip: longest,
    maxSogKn,
    nightsAtAnchor,
    hoursAtAnchor,
    hoursMoored,
    modeBreakdown,
    perMonth: [...perMonthMap.values()].sort((a, b) => (a.ym < b.ym ? -1 : 1)),
  };
}
