import {
  Channels,
  setSharedChannelHistory,
  type Bus,
  type ChannelHistory,
  type ChannelHistorySnapshot,
  type ChannelSeries,
  type HistoryPoint,
} from '@g5000/core';

/**
 * Records a rolling, per-(channel, source) ring of raw scalar samples straight
 * off the bus, so the wind-diagnostic UI can compare every source feeding each
 * channel — e.g. the three apparent-wind sources (raw masthead vs. H5000-CPU
 * corrected) or the two disagreeing magnetic-heading sources (Precision-9 vs.
 * ZG100). Values are the undamped bus scalars in SI units (m/s, rad); the bus
 * carries one Sample per decoded frame tagged by source, so this captures the
 * jumpiness that `/api/stream` (winner-select + EMA) would hide.
 *
 * Storage shape: nested map { channel -> { source -> HistoryPoint[] } }, each
 * inner array kept sorted by arrival (append-only) and evicted at write time.
 */

/** The seven wind-diagnostic channels captured by default. */
const DEFAULT_CHANNELS: string[] = [
  Channels.Wind.ApparentSpeed,
  Channels.Wind.ApparentAngle,
  Channels.Wind.TrueSpeed,
  Channels.Wind.TrueAngle,
  Channels.Wind.TrueDirection,
  Channels.Boat.HeadingMagnetic,
  Channels.Boat.SpeedWater,
  // H5000's own performance/wind broadcast (PGN 130824), for side-by-side
  // comparison against g5000's computed values on /wind-diag.
  'bandg.trueWindDirection',
  'bandg.avgTrueWindDirection',
  'bandg.trueWindSpeed',
  'bandg.trueWindAngle',
  'bandg.targetTwa',
  'bandg.targetSpeed',
  'bandg.polarPerformance',
  'bandg.vmgPerformance',
  'bandg.leeway',
];

const DEFAULT_WINDOW_MS = 300_000; // 5 min
const DEFAULT_MAX_POINTS = 3000;

interface InternalState {
  // channel -> source -> rolling points (append-ordered, oldest first)
  by: Map<string, Map<string, HistoryPoint[]>>;
  unsubscribe: () => void;
}

/**
 * Install a bus subscriber that appends every scalar sample on the tracked
 * channels to a per-(channel, source) ring buffer. Returns the tracker + an
 * explicit teardown for tests; also registers the tracker via
 * `setSharedChannelHistory` so Next.js API routes can resolve it through
 * `getSharedChannelHistory()`.
 */
export function installChannelHistoryTracker(
  bus: Bus,
  opts: { channels?: string[]; windowMs?: number; maxPointsPerSeries?: number } = {},
): {
  tracker: ChannelHistory;
  teardown: () => void;
} {
  const tracked = new Set(opts.channels ?? DEFAULT_CHANNELS);
  const windowMs = opts.windowMs ?? DEFAULT_WINDOW_MS;
  const maxPoints = opts.maxPointsPerSeries ?? DEFAULT_MAX_POINTS;

  const state: InternalState = {
    by: new Map(),
    unsubscribe: () => {},
  };

  state.unsubscribe = bus.subscribe('**', (s) => {
    if (!tracked.has(s.channel)) return;
    if (s.value.kind !== 'scalar') return;
    let perSource = state.by.get(s.channel);
    if (!perSource) {
      perSource = new Map();
      state.by.set(s.channel, perSource);
    }
    let points = perSource.get(s.source);
    if (!points) {
      points = [];
      perSource.set(s.source, points);
    }
    const tMs = Number(s.t_ns / 1_000_000n);
    points.push({ tMs, v: s.value.value });
    // Evict at write time: drop points older than windowMs relative to the
    // newest, then cap length at maxPoints (drop oldest first).
    const cutoff = tMs - windowMs;
    let drop = 0;
    while (drop < points.length && (points[drop] as HistoryPoint).tMs < cutoff) drop++;
    if (drop > 0) points.splice(0, drop);
    if (points.length > maxPoints) points.splice(0, points.length - maxPoints);
  });

  const tracker: ChannelHistory = {
    snapshot(
      snapWindowMs = windowMs,
      channels = opts.channels ?? DEFAULT_CHANNELS,
    ): ChannelHistorySnapshot {
      const want = new Set(channels);
      // Anchor the read window to the NEWEST sample across the requested
      // channels, not Date.now(). The write-time eviction above is already
      // newest-relative, and replay (REPLAY=) re-emits samples with their
      // original historical t_ns (replay-driver preserves rxTimestamp), so a
      // Date.now() cutoff would reject every replayed point and show an empty
      // view. Newest-relative is correct for live (newest ≈ now) and replay
      // (newest = the recorded time) alike.
      let newestMs = -Infinity;
      for (const [channel, perSource] of state.by.entries()) {
        if (!want.has(channel)) continue;
        for (const points of perSource.values()) {
          const last = points[points.length - 1];
          if (last && last.tMs > newestMs) newestMs = last.tMs;
        }
      }
      if (newestMs === -Infinity) return { windowMs: snapWindowMs, series: [] };
      const cutoffMs = newestMs - snapWindowMs;
      const series: ChannelSeries[] = [];
      for (const [channel, perSource] of state.by.entries()) {
        if (!want.has(channel)) continue;
        for (const [source, points] of perSource.entries()) {
          const within = points.filter((p) => p.tMs >= cutoffMs);
          if (within.length === 0) continue;
          series.push({ channel, source, points: within });
        }
      }
      series.sort((a, b) => {
        if (a.channel !== b.channel) return a.channel < b.channel ? -1 : 1;
        return a.source < b.source ? -1 : a.source === b.source ? 0 : 1;
      });
      return { windowMs: snapWindowMs, series };
    },
  };

  setSharedChannelHistory(tracker);

  return {
    tracker,
    teardown: () => {
      state.unsubscribe();
      state.by.clear();
    },
  };
}
