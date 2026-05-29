import { activeTrack, type TrackPoint } from './tracks';
import { haversineM } from './geo';

/**
 * Sum the haversine distance over the subset of `points` whose timestamps
 * fall in [`fromS`, `toS`]. Points are assumed sorted ascending by `t`.
 * Lower-bounded by a binary search so a single 24h scan over a multi-day
 * track stays cheap.
 */
export function distanceInWindow(points: TrackPoint[], fromS: number, toS: number): number {
  if (points.length < 2) return 0;
  // Find first index with t >= fromS via binary search.
  let lo = 0;
  let hi = points.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (points[mid]!.t < fromS) lo = mid + 1;
    else hi = mid;
  }
  let dist = 0;
  let prev: TrackPoint | null = null;
  for (let i = lo; i < points.length; i++) {
    const p = points[i]!;
    if (p.t > toS) break;
    if (prev) dist += haversineM(prev.lat, prev.lon, p.lat, p.lon);
    prev = p;
  }
  return dist;
}

export interface DistanceStats {
  /** Over-ground path length over each window, metres. */
  d1hM: number;
  d3hM: number;
  d6hM: number;
  d12hM: number;
  d24hM: number;
  /** Latest track-point timestamp (UNIX seconds), or null if track is empty. */
  lastPointAt: number | null;
  /** Active track ID, null if none. */
  trackId: string | null;
  /** Track-start UNIX seconds, null if none. */
  trackStartAt: number | null;
  /**
   * One bucket per hour, ending at the top of each hour going back to the
   * earliest hour mark whose 24h window starts at or after the track's
   * first point. Each `endingAt` is a UNIX second on an hour boundary.
   * Empty if the track is younger than 24h. Newest first.
   */
  history24h: Array<{ endingAt: number; d24hM: number }>;
  /**
   * Previous-day buckets, one per calendar day (UTC), newest first.
   * `startsAt`/`endsAt` are UNIX seconds on UTC midnight boundaries.
   * Up to 7 entries — fewer if the track is younger. Always disjoint from
   * the rolling-24h tile (each entry is a fixed UTC-midnight bucket, not
   * a rolling window).
   */
  daily7: Array<{
    startsAt: number;
    endsAt: number;
    distanceM: number;
    /** True if the bucket window is fully covered by the track (the track's
     *  first point is at or before `startsAt`). When false the value is a
     *  partial total — usually only the oldest bucket. */
    complete: boolean;
  }>;
}

const HOUR = 3600;

export async function computeDistanceStats(
  nowS: number = Date.now() / 1000,
): Promise<DistanceStats> {
  const track = await activeTrack();
  if (!track || track.points.length === 0) {
    return {
      d1hM: 0,
      d3hM: 0,
      d6hM: 0,
      d12hM: 0,
      d24hM: 0,
      lastPointAt: null,
      trackId: null,
      trackStartAt: null,
      history24h: [],
      daily7: [],
    };
  }
  const points = track.points;
  const last = points[points.length - 1]!;
  const first = points[0]!;

  // Rolling windows always end at `nowS`. Path length is taken from track
  // points within [nowS - W, nowS]. If the boat has been still since the
  // last fix, the result is 0 — which is the right answer for fuel use.
  const d = (windowS: number): number => distanceInWindow(points, nowS - windowS, nowS);

  // 24h history: one bucket per hour mark. The most-recent bucket is the
  // last completed hour boundary <= nowS. The oldest bucket is the first
  // hour boundary where the 24h window still has at least the track's
  // first sample inside it.
  const lastHourMark = Math.floor(nowS / HOUR) * HOUR;
  const oldestStartS = first.t; // earliest sample timestamp
  const oldestHourMark = Math.ceil((oldestStartS + 24 * HOUR) / HOUR) * HOUR;
  const history: Array<{ endingAt: number; d24hM: number }> = [];
  for (let h = lastHourMark; h >= oldestHourMark; h -= HOUR) {
    history.push({ endingAt: h, d24hM: distanceInWindow(points, h - 24 * HOUR, h) });
  }

  // Calendar-day buckets at UTC midnight. The "previous full day" is the
  // bucket ending at the most recent UTC midnight <= nowS; older ones go
  // back from there. Limited to 7 entries.
  const DAY = 86400;
  const todayMidnight = Math.floor(nowS / DAY) * DAY;
  const daily7: DistanceStats['daily7'] = [];
  for (let i = 0; i < 7; i++) {
    const endsAt = todayMidnight - i * DAY;
    const startsAt = endsAt - DAY;
    if (endsAt <= first.t) break; // window entirely before track start
    daily7.push({
      startsAt,
      endsAt,
      distanceM: distanceInWindow(points, startsAt, endsAt),
      complete: startsAt >= first.t,
    });
  }

  return {
    d1hM: d(HOUR),
    d3hM: d(3 * HOUR),
    d6hM: d(6 * HOUR),
    d12hM: d(12 * HOUR),
    d24hM: d(24 * HOUR),
    lastPointAt: last.t,
    trackId: track.id,
    trackStartAt: first.t,
    history24h: history,
    daily7,
  };
}
