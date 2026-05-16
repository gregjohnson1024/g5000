import {
  Channels,
  setSharedHdgStats,
  type Bus,
  type Sample,
  type SharedHdgStats,
  type HdgStatsSnapshot,
} from '@g5000/core';

const DEFAULT_WINDOW_MS = 15 * 60 * 1000;

interface BufferEntry {
  /** ms since Unix epoch. */
  t: number;
  /** Unit-vector components of the HDG sample (radians). */
  sin: number;
  cos: number;
}

/**
 * Subscribe to the boat's heading and maintain a circular-mean rolling
 * window. Same math as cog-stats but on the heading channel. Prefers
 * True heading (`boat.heading.true`); falls back to applying magnetic
 * variation to `boat.heading.magnetic` when only Magnetic is published.
 *
 * Pair the snapshot with `getSharedCogStats()` to compute the drift /
 * set angle: `drift = avgCog - avgHdg`, normalised to [-π, π].
 */
export function startHdgStats(
  bus: Bus,
  windowMs: number = DEFAULT_WINDOW_MS,
): { stop: () => void } {
  const buf: BufferEntry[] = [];
  let lastMagVarRad = 0;

  const shared: SharedHdgStats = {
    snapshot(): HdgStatsSnapshot {
      const head = buf[0];
      const tail = buf[buf.length - 1];
      if (!head || !tail) {
        return {
          avgRad: null,
          concentration: 0,
          coveredMs: 0,
          samples: 0,
          windowMs,
          lastSampleAt: null,
        };
      }
      let sumSin = 0;
      let sumCos = 0;
      for (const s of buf) {
        sumSin += s.sin;
        sumCos += s.cos;
      }
      const meanSin = sumSin / buf.length;
      const meanCos = sumCos / buf.length;
      const R = Math.hypot(meanSin, meanCos);
      const avgRad = R < 0.01
        ? null
        : ((Math.atan2(meanSin, meanCos) % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
      return {
        avgRad,
        concentration: R,
        coveredMs: tail.t - head.t,
        samples: buf.length,
        windowMs,
        lastSampleAt: tail.t / 1000,
      };
    },
  };
  setSharedHdgStats(shared);

  const accept = (sample: Sample, isMagnetic: boolean): void => {
    if (sample.value.kind !== 'scalar') return;
    const raw = sample.value.value;
    if (!Number.isFinite(raw)) return;
    const v = isMagnetic ? raw + lastMagVarRad : raw;
    const t = Number(sample.t_ns / 1_000_000n);
    buf.push({ t, sin: Math.sin(v), cos: Math.cos(v) });
    const cutoff = t - windowMs;
    let drop = 0;
    while (drop < buf.length) {
      const h = buf[drop];
      if (h === undefined || h.t >= cutoff) break;
      drop++;
    }
    if (drop > 0) buf.splice(0, drop);
  };

  // Track magnetic variation so we can normalise Magnetic heading to True.
  const unsubMagVar = bus.subscribe(Channels.Nav.MagVar, (s: Sample) => {
    if (s.value.kind === 'scalar' && Number.isFinite(s.value.value)) {
      lastMagVarRad = s.value.value;
    }
  });

  // Prefer True heading if available. If only Magnetic comes in, fold in
  // the latest mag-var so the buffered values are still in True frame
  // (which matches the COG channel — so drift = COG_T − HDG_T is meaningful).
  const unsubTrue = bus.subscribe(Channels.Boat.HeadingTrue, (s) => accept(s, false));
  const unsubMag = bus.subscribe(Channels.Boat.HeadingMagnetic, (s) => {
    // Only consume Magnetic if True hasn't arrived recently (in the last 5 s).
    const now = Date.now();
    const recentTrue = buf.some((e) => now - e.t < 5000);
    if (!recentTrue) accept(s, true);
  });

  return {
    stop(): void {
      unsubTrue();
      unsubMag();
      unsubMagVar();
      buf.length = 0;
    },
  };
}
