import {
  Channels,
  setSharedSogStats,
  type Bus,
  type Sample,
  type SharedSogStats,
  type SogStatsSnapshot,
} from '@g5000/core';

const DEFAULT_WINDOW_MS = 15 * 60 * 1000; // 15 minutes

interface BufferEntry {
  /** ms since Unix epoch. */
  t: number;
  /** SOG, m/s. */
  v: number;
}

/**
 * Subscribe to `nav.gps.sog` on the bus and maintain a rolling-window mean.
 * The buffer is in-memory in the g5000 app (not persisted) so it
 * starts empty on every server restart; once running, it survives all
 * client navigation. Returns a `stop()` to unsubscribe — call from the
 * server's `stops[]` for clean shutdown.
 *
 * The bus emits Sample timestamps in nanoseconds; we convert to ms once
 * per sample and store as numbers (small enough for Date.now()-range).
 *
 * Why on the server: in-component React refs in /helm reset on every page
 * mount, so the "AVG SOG (1 min so far)" tile resets to 1 min every time
 * the user switches tabs. Moving the buffer here makes the statistic a
 * property of the boat, not of the browser session.
 */
export function startSogStats(
  bus: Bus,
  windowMs: number = DEFAULT_WINDOW_MS,
): { stop: () => void } {
  const buf: BufferEntry[] = [];

  const shared: SharedSogStats = {
    snapshot(): SogStatsSnapshot {
      const head = buf[0];
      const tail = buf[buf.length - 1];
      if (!head || !tail) {
        return {
          avgMs: null,
          coveredMs: 0,
          samples: 0,
          windowMs,
          lastSampleAt: null,
        };
      }
      let sum = 0;
      for (const s of buf) sum += s.v;
      return {
        avgMs: sum / buf.length,
        coveredMs: tail.t - head.t,
        samples: buf.length,
        windowMs,
        lastSampleAt: tail.t / 1000,
      };
    },
  };
  setSharedSogStats(shared);

  const unsub = bus.subscribe(Channels.Nav.Sog, (s: Sample) => {
    if (s.value.kind !== 'scalar') return;
    const v = s.value.value;
    if (!Number.isFinite(v)) return;
    // Bus timestamps are bigint ns since epoch — drop to ms for arithmetic.
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
  });

  return {
    stop(): void {
      unsub();
      buf.length = 0;
    },
  };
}
