/**
 * Shared types + globalThis-backed accessor for the AIS targets registry.
 *
 * The registry tracks vessel positions/courses keyed by MMSI. It's a singleton
 * because the bridge (which feeds it from decoded AIS PGNs) and the Next.js
 * routes (which read it) run in the same Node process but Turbopack may
 * instantiate workspace packages more than once — same pattern used by the
 * shared Bus, ConfigStore, DeviceRegistry, and SourceModeController.
 *
 * The actual implementation lives in `@g5000/bridge` (`createAisTargetsRegistry`).
 * Consumers only need the types and the accessor.
 */

export type VesselClass = 'A' | 'B' | 'unknown';

export interface AisTarget {
  /** Maritime Mobile Service Identity — primary key */
  mmsi: number;
  vesselClass: VesselClass;
  /** Ship name from static data (Class A: 129794, Class B: 129809/810) */
  name?: string;
  /** Latitude in degrees, +N */
  lat?: number;
  /** Longitude in degrees, +E */
  lon?: number;
  /** Course Over Ground, radians (0 = N, π/2 = E) */
  cog?: number;
  /** Speed Over Ground, m/s */
  sog?: number;
  /** True heading, radians */
  heading?: number;
  /** Rate of turn, rad/s */
  rateOfTurn?: number;
  /** Vessel type code (per ITU-R M.1371) */
  vesselType?: number;
  /** Length over all, meters */
  length?: number;
  /** Beam, meters */
  beam?: number;
  /** Last time we saw any update for this MMSI (epoch ms) */
  lastSeenMs: number;
}

export interface AisTargetsRegistry {
  /** All currently-tracked targets. */
  all(): AisTarget[];
  /** Single target lookup. */
  get(mmsi: number): AisTarget | undefined;
  /** Merge an update from a decoded PGN. Missing fields keep prior values. */
  upsert(update: Partial<AisTarget> & { mmsi: number }): void;
  /** Drop targets whose lastSeenMs is older than `maxAgeMs`. Returns count dropped. */
  evictStale(maxAgeMs: number): number;
  /** Drop everything (for tests). */
  clear(): void;
}

declare const globalThis: { __g5000_aisTargets__?: AisTargetsRegistry };

/**
 * Get the process-wide AIS targets registry, or `undefined` if no producer has
 * created one yet. Consumers that need a guaranteed registry should call
 * `createAisTargetsRegistry()` from `@g5000/bridge` instead.
 */
export function getSharedAisTargets(): AisTargetsRegistry | undefined {
  return globalThis.__g5000_aisTargets__;
}

/** Install the registry as the singleton. Called by the bridge on first use. */
export function setSharedAisTargets(r: AisTargetsRegistry): void {
  globalThis.__g5000_aisTargets__ = r;
}

/** Test helper — clear the singleton. Do not call in production code. */
export function _resetAisTargetsForTests(): void {
  globalThis.__g5000_aisTargets__ = undefined;
}
