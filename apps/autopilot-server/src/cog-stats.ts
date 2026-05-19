import {
  Channels,
  setSharedCogStats,
  type Bus,
  type Sample,
  type SharedCogStats,
  type CogStatsSnapshot,
} from '@g5000/core';

const DEFAULT_WINDOW_MS = 15 * 60 * 1000;

interface BufferEntry {
  /** ms since Unix epoch. */
  t: number;
  /** Unit-vector components of the COG sample (radians). Storing these
   *  rather than the raw angle saves the trig per snapshot — and the
   *  vector mean is the circular mean by definition. */
  sin: number;
  cos: number;
}

/**
 * Subscribe to `nav.gps.cog` and maintain a circular-mean rolling window.
 * Two compass headings 5° apart should average to a heading 2.5° between
 * them — naive arithmetic mean of degrees breaks this when the
 * underlying samples straddle 0°/360°. Vector mean fixes it: take each
 * sample as a unit (sin θ, cos θ), average the components, then atan2.
 *
 * The mean-resultant length R = √(meanSin² + meanCos²) ∈ [0,1] is also
 * reported as `concentration` so the UI can grey out a meaningless mean
 * when the boat has been changing direction wildly.
 */
export function startCogStats(
  bus: Bus,
  windowMs: number = DEFAULT_WINDOW_MS,
): { stop: () => void } {
  const buf: BufferEntry[] = [];

  const shared: SharedCogStats = {
    snapshot(): CogStatsSnapshot {
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
      // Below ~0.01 the angle is essentially undefined (samples nearly
      // uniformly distributed). Return null to signal that to the UI.
      const avgRad =
        R < 0.01
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
  setSharedCogStats(shared);

  const unsub = bus.subscribe(Channels.Nav.Cog, (s: Sample) => {
    if (s.value.kind !== 'scalar') return;
    const v = s.value.value;
    if (!Number.isFinite(v)) return;
    const t = Number(s.t_ns / 1_000_000n);
    buf.push({ t, sin: Math.sin(v), cos: Math.cos(v) });
    const cutoff = t - windowMs;
    let drop = 0;
    while (drop < buf.length) {
      const h = buf[drop];
      if (h === undefined || h.t >= cutoff) break;
      drop++;
    }
    if (drop > 0) buf.splice(0, drop);
  });

  return {
    stop(): void {
      unsub();
      buf.length = 0;
    },
  };
}
