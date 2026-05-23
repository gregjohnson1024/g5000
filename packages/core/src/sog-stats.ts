/**
 * Shared accessor for the server-side SOG rolling-window statistic.
 *
 * The g5000 app subscribes to `nav.gps.sog` from the bus, keeps a
 * rolling buffer of samples for some window (default 15 min), and registers
 * itself via {@link setSharedSogStats}. Route handlers in @g5000/web read
 * the snapshot via {@link getSharedSogStats} so the UI doesn't have to
 * maintain its own buffer in a React ref — the buffer survives page
 * navigation and reloads.
 */

export interface SogStatsSnapshot {
  /** Rolling-window mean SOG, m/s. `null` if no samples have arrived yet. */
  avgMs: number | null;
  /** ms covered by the buffer — between the oldest and most recent sample.
   *  Always <= `windowMs`. 0 if no samples. */
  coveredMs: number;
  /** Number of samples currently in the buffer. */
  samples: number;
  /** Configured window length in ms (e.g. 900000 for 15 min). */
  windowMs: number;
  /** UNIX seconds — time of the most recent sample. `null` if none. */
  lastSampleAt: number | null;
}

export interface SharedSogStats {
  snapshot(): SogStatsSnapshot;
}

declare const globalThis: { __g5000_sog_stats__?: SharedSogStats };

export function getSharedSogStats(): SharedSogStats | undefined {
  return globalThis.__g5000_sog_stats__;
}

export function setSharedSogStats(s: SharedSogStats): void {
  globalThis.__g5000_sog_stats__ = s;
}

export function _resetSogStatsForTests(): void {
  globalThis.__g5000_sog_stats__ = undefined;
}
