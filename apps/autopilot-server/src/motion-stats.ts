import {
  Channels,
  setSharedMotionStats,
  type Bus,
  type Sample,
  type SharedMotionStats,
  type MotionStatsSnapshot,
} from '@g5000/core';

const DEFAULT_WINDOW_MS = 15 * 60 * 1000;

interface BufferEntry {
  /** ms since Unix epoch. */
  t: number;
  /** Sample value, radians. */
  v: number;
}

/**
 * Maintain a rolling buffer of pitch + heel samples and report their
 * RMS deviation from the within-window mean. RMS rather than stddev
 * because stddev applies Bessel's correction (n-1), which over-estimates
 * variance for the small buffer sizes we hit on cold start; RMS is the
 * straight 2nd-moment-of-deviations, which lines up with what "how big
 * are the swings" intuitively means.
 */
export function startMotionStats(
  bus: Bus,
  windowMs: number = DEFAULT_WINDOW_MS,
): { stop: () => void } {
  const heelBuf: BufferEntry[] = [];
  const pitchBuf: BufferEntry[] = [];

  function rms(buf: BufferEntry[]): number | null {
    if (buf.length === 0) return null;
    let sum = 0;
    for (const e of buf) sum += e.v;
    const mean = sum / buf.length;
    let sqDev = 0;
    for (const e of buf) {
      const d = e.v - mean;
      sqDev += d * d;
    }
    return Math.sqrt(sqDev / buf.length);
  }

  const shared: SharedMotionStats = {
    snapshot(): MotionStatsSnapshot {
      const heelRms = rms(heelBuf);
      const pitchRms = rms(pitchBuf);
      const combined =
        heelRms !== null && pitchRms !== null
          ? Math.hypot(heelRms, pitchRms)
          : heelRms ?? pitchRms;
      const allBuf = [...heelBuf, ...pitchBuf];
      const head = allBuf.reduce<BufferEntry | null>(
        (a, b) => (a === null || b.t < a.t ? b : a),
        null,
      );
      const tail = allBuf.reduce<BufferEntry | null>(
        (a, b) => (a === null || b.t > a.t ? b : a),
        null,
      );
      return {
        heelRmsRad: heelRms,
        pitchRmsRad: pitchRms,
        combinedRmsRad: combined,
        coveredMs: head && tail ? tail.t - head.t : 0,
        samples: heelBuf.length + pitchBuf.length,
        windowMs,
        lastSampleAt: tail ? tail.t / 1000 : null,
      };
    },
  };
  setSharedMotionStats(shared);

  function accept(buf: BufferEntry[], s: Sample): void {
    if (s.value.kind !== 'scalar') return;
    const v = s.value.value;
    if (!Number.isFinite(v)) return;
    const t = Number(s.t_ns / 1_000_000n);
    buf.push({ t, v });
    const cutoff = t - windowMs;
    let drop = 0;
    while (drop < buf.length) {
      const h = buf[drop];
      if (h === undefined || h.t >= cutoff) break;
      drop++;
    }
    if (drop > 0) buf.splice(0, drop);
  }

  const unsubHeel = bus.subscribe(Channels.Motion.Heel, (s) => accept(heelBuf, s));
  const unsubPitch = bus.subscribe(Channels.Motion.Pitch, (s) => accept(pitchBuf, s));

  return {
    stop(): void {
      unsubHeel();
      unsubPitch();
      heelBuf.length = 0;
      pitchBuf.length = 0;
    },
  };
}
