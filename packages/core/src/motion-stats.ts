/**
 * Shared accessor for the server-side boat-motion rolling-window statistic.
 *
 * Tracks how "bouncy" the ride is by computing the RMS deviation of the
 * boat's heel and pitch from their respective rolling means. A flat ocean
 * → near-zero RMS; a confused chop → several degrees. Source is the
 * H5000 3D motion sensor (PGN 127257) published on `motion.heel` and
 * `motion.pitch`.
 */

export interface MotionStatsSnapshot {
  /** RMS of (heel − meanHeel) over the window, radians. null if no samples. */
  heelRmsRad: number | null;
  /** RMS of (pitch − meanPitch) over the window, radians. null if no samples. */
  pitchRmsRad: number | null;
  /** Combined motion: sqrt(heelRms² + pitchRms²), radians. null if neither component has samples. */
  combinedRmsRad: number | null;
  /** ms covered by the buffer (most-recent − oldest sample). */
  coveredMs: number;
  /** Number of samples currently in the buffer. */
  samples: number;
  /** Configured window length in ms. */
  windowMs: number;
  /** UNIX seconds — time of the most recent sample. null if none. */
  lastSampleAt: number | null;
}

export interface SharedMotionStats {
  snapshot(): MotionStatsSnapshot;
}

declare const globalThis: { __g5000_motion_stats__?: SharedMotionStats };

export function getSharedMotionStats(): SharedMotionStats | undefined {
  return globalThis.__g5000_motion_stats__;
}

export function setSharedMotionStats(s: SharedMotionStats): void {
  globalThis.__g5000_motion_stats__ = s;
}

export function _resetMotionStatsForTests(): void {
  globalThis.__g5000_motion_stats__ = undefined;
}
