/**
 * Shared accessor for the server-side COG rolling-window statistic.
 *
 * Mirrors {@link SogStatsSnapshot} in shape but with circular-mean math —
 * averaging 350° and 10° as direction must produce ~0°, not 180°. The
 * autopilot-server's `startCogStats` buffers raw COG samples (radians)
 * and computes the mean unit vector on snapshot; `avgRad` is the
 * atan2 of that mean.
 */

export interface CogStatsSnapshot {
  /** Circular mean of COG samples (radians, [0, 2π)). `null` if no
   *  samples or the mean unit vector is degenerate (concentration ≈ 0). */
  avgRad: number | null;
  /** Mean-resultant length R ∈ [0, 1]: 1 = all samples colinear,
   *  0 = uniformly distributed. Indicates how meaningful `avgRad` is. */
  concentration: number;
  /** ms covered by the buffer (most-recent - oldest sample). */
  coveredMs: number;
  /** Number of samples currently in the buffer. */
  samples: number;
  /** Configured window length in ms. */
  windowMs: number;
  /** UNIX seconds — time of the most recent sample. `null` if none. */
  lastSampleAt: number | null;
}

export interface SharedCogStats {
  snapshot(): CogStatsSnapshot;
}

declare const globalThis: { __g5000_cog_stats__?: SharedCogStats };

export function getSharedCogStats(): SharedCogStats | undefined {
  return globalThis.__g5000_cog_stats__;
}

export function setSharedCogStats(s: SharedCogStats): void {
  globalThis.__g5000_cog_stats__ = s;
}

export function _resetCogStatsForTests(): void {
  globalThis.__g5000_cog_stats__ = undefined;
}
