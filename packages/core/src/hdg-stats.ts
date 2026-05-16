/**
 * Shared accessor for the server-side HDG (boat heading) rolling-window
 * statistic. Mirrors {@link CogStatsSnapshot} — circular mean of compass
 * headings (radians, [0, 2π)) plus a concentration metric R ∈ [0, 1].
 *
 * Pair this with avg-COG to compute the drift angle (current set):
 * `drift = avgCog - avgHdg`, normalised to [-π, π]. In a calm-current
 * world a motoring boat's heading and ground track align, so a non-zero
 * drift is approximately the perpendicular component of the current.
 */

export interface HdgStatsSnapshot {
  /** Circular mean of HDG samples (radians, [0, 2π)). null if no samples
   *  or the mean unit vector is degenerate. */
  avgRad: number | null;
  /** Mean-resultant length R ∈ [0, 1]. */
  concentration: number;
  /** ms covered by the buffer (most-recent − oldest sample). */
  coveredMs: number;
  /** Number of samples currently in the buffer. */
  samples: number;
  /** Configured window length in ms. */
  windowMs: number;
  /** UNIX seconds — time of the most recent sample. null if none. */
  lastSampleAt: number | null;
}

export interface SharedHdgStats {
  snapshot(): HdgStatsSnapshot;
}

declare const globalThis: { __g5000_hdg_stats__?: SharedHdgStats };

export function getSharedHdgStats(): SharedHdgStats | undefined {
  return globalThis.__g5000_hdg_stats__;
}

export function setSharedHdgStats(s: SharedHdgStats): void {
  globalThis.__g5000_hdg_stats__ = s;
}

export function _resetHdgStatsForTests(): void {
  globalThis.__g5000_hdg_stats__ = undefined;
}
