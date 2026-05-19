/**
 * Identity / zero-correction defaults for all config singletons. These are
 * what new databases get on first boot — every cal cell is zero, BoatConfig
 * is filled with sensible-but-overridable rig estimates.
 */

export interface BoatConfig {
  /** Mast height above the masthead unit's measurement reference, meters. */
  mastHeight: number;
  /** Distance from masthead to bow tip along the boat-x axis, meters. */
  mastheadOffsetX: number;
  /** Lateral offset of the masthead from the boat centerline, meters. */
  mastheadOffsetY: number;
  /** Magnetic variation for the sailing area, degrees (positive = east). */
  magVarDeg: number;
  /** This vessel's MMSI. When set, AIS targets matching it are filtered out
   *  of the chart view so we don't see ourselves on the radar. */
  selfMmsi?: number;
}

/**
 * Two-dimensional grid indexed by AWS bin × AWA bin. Each cell holds two
 * correction values: an angle correction (radians, added to AWA) and a
 * speed multiplier (dimensionless, 1.0 = no correction). Bilinear
 * interpolation between cells.
 */
export interface AwsAwaCalTable {
  /** Wind-speed bin centers, m/s. Strictly increasing. */
  awsBins: number[];
  /** Wind-angle bin centers, radians. Strictly increasing. Must cover [0, π]. */
  awaBins: number[];
  /** Angle correction grid in radians, [awsBins.length][awaBins.length]. */
  angleCorrection: number[][];
  /** Speed multiplier grid (1.0 = no correction), [awsBins.length][awaBins.length]. */
  speedMultiplier: number[][];
}

export interface BspCal {
  /** BSP bin centers, m/s. Strictly increasing. */
  bins: number[];
  /** Multiplier per bin (1.0 = no correction). */
  multiplier: number[];
}

export interface CompassDeviation {
  /** 36 entries, one per 10° heading bin. Index 0 = heading 0–10°. Radians, additive. */
  deviation: number[];
}

// Unit conversions — declared up front so the default tables below can write
// bin centres in friendly units (knots, degrees) and convert to SI for storage.
const DEG = Math.PI / 180;
const KN = 0.514444; // knots → m/s

export const DEFAULT_BOAT_CONFIG: BoatConfig = {
  mastHeight: 18, // meters; rough catamaran value
  mastheadOffsetX: 0,
  mastheadOffsetY: 0,
  magVarDeg: 0,
};

const zeros2D = (rows: number, cols: number): number[][] =>
  Array.from({ length: rows }, () => Array.from({ length: cols }, () => 0));

const ones2D = (rows: number, cols: number): number[][] =>
  Array.from({ length: rows }, () => Array.from({ length: cols }, () => 1));

/** Default 8 AWS bins × 13 AWA bins; identity (no correction). */
export const DEFAULT_AWS_AWA_CAL: AwsAwaCalTable = {
  awsBins: [2, 4, 6, 8, 10, 12, 16, 20], // m/s
  awaBins: Array.from({ length: 13 }, (_, i) => (i * Math.PI) / 12), // 0, 15°, 30°, … 180°
  angleCorrection: zeros2D(8, 13),
  speedMultiplier: ones2D(8, 13),
};

export const DEFAULT_BSP_CAL: BspCal = {
  // Clean knot bins (2, 4, 6, 8, 10, 12, 15, 20 kn) stored as m/s.
  bins: [2, 4, 6, 8, 10, 12, 15, 20].map((v) => v * KN),
  multiplier: Array.from({ length: 8 }, () => 1.0),
};

export const DEFAULT_COMPASS_DEVIATION: CompassDeviation = {
  deviation: Array.from({ length: 36 }, () => 0),
};

/**
 * Boat polar: rows = true wind speed bins, cols = true wind angle bins.
 * `boatSpeed[twsIdx][twaIdx]` is target boat speed (m/s) at that wind state.
 * Both bin arrays must be strictly increasing. TWA bins must span [0, π].
 */
export interface PolarTable {
  /** True wind speed bin centers, m/s. */
  twsBins: number[];
  /** True wind angle bin centers, radians (always positive — table is symmetric). */
  twaBins: number[];
  /** Target boat speed in m/s, indexed [twsIdx][twaIdx]. */
  boatSpeed: number[][];
  /**
   * Optional heel grid, radians (signed; lee positive). Same shape as boatSpeed.
   * Absent means "unknown" — consumers that don't need heel ignore this field.
   */
  heel?: number[][];
  /**
   * Optional leeway grid, radians. Same shape as boatSpeed. Absent means
   * "unknown".
   */
  leeway?: number[][];
}

/** Stable per-boat identifier. Single active boat per process today. */
export type BoatId = string;

/**
 * Operating regime for a polar. 'default' is the universal fallback when a
 * boat has only one regime. High-performance boats may carry several (e.g.
 * 'displacement', 'planing', 'foiling'). Unknown values are accepted at the
 * type level — modes are configuration, not enum-policed.
 */
export type PolarMode = 'default' | 'displacement' | 'planing' | 'foiling' | string;

/** Provenance kind for an individual polar revision. */
export type PolarLineageKind =
  | 'migrated'
  | 'manual_edit'
  | 'imported_csv'
  | 'imported_pol'
  | 'vpp'
  | 'cfd'
  | 'towing_tank'
  | 'measured'
  | 'regression'
  | 'expert_judgment';

/** Free-form provenance metadata attached to a revision. */
export interface PolarLineage {
  kind: PolarLineageKind;
  /** Optional citation: designer name, file path, run-id, etc. */
  source?: string;
  notes?: string;
}

/**
 * An immutable polar revision. One row in the `polar_revisions` table.
 * The `table` field is JSON-encoded into `value_json` at the SQL layer.
 */
export interface PolarRevision {
  /** ULID. Lexicographically sortable by createdAt. */
  id: string;
  boatId: BoatId;
  sailConfigId: string;
  mode: PolarMode;
  /** Parent revision in the lineage chain, or null for a root. */
  parentRevisionId: string | null;
  /** UNIX seconds. */
  createdAt: number;
  lineage: PolarLineage;
  /** Optional scalar uncertainty in m/s. Reserved for future fusion work. */
  sigma?: number;
  table: PolarTable;
}

/**
 * Baseline catamaran-ish polar. Values are deliberately rough — the user is
 * expected to import their own polar via CSV before performance numbers are
 * trustworthy. Shape: 8 TWS bins × 9 TWA bins.
 *
 * Boat speeds chosen to roughly resemble a 40' sport catamaran in displacement
 * mode. Real boats vary widely.
 */
// Bin centres are written in knots and degrees in the source for legibility,
// then converted to SI (m/s, radians) for storage.
export const DEFAULT_POLARS: PolarTable = {
  twsBins: [6, 8, 10, 12, 14, 16, 20, 25].map((v) => v * KN),
  twaBins: [0, 30, 45, 60, 90, 120, 135, 150, 180].map((d) => d * DEG),
  // Rows = TWS (low to high in kn), cols = TWA (0=in-irons, 180°=dead-down).
  // Boat-speed values are in knots in source; the `.map(v => v * KN)` converts.
  boatSpeed: [
    // TWS 6 kn
    [0, 2.5, 3.5, 4.0, 4.2, 4.0, 3.8, 3.4, 2.0].map((v) => v * KN),
    // TWS 8 kn
    [0, 3.0, 4.5, 5.0, 5.4, 5.5, 5.3, 4.8, 3.0].map((v) => v * KN),
    // TWS 10 kn
    [0, 3.5, 5.0, 5.8, 6.4, 6.8, 6.7, 6.2, 4.4].map((v) => v * KN),
    // TWS 12 kn
    [0, 3.8, 5.6, 6.6, 7.4, 8.0, 7.9, 7.4, 5.8].map((v) => v * KN),
    // TWS 14 kn
    [0, 4.0, 6.0, 7.2, 8.2, 9.0, 9.0, 8.6, 7.0].map((v) => v * KN),
    // TWS 16 kn
    [0, 4.1, 6.2, 7.5, 8.8, 9.7, 9.8, 9.4, 7.8].map((v) => v * KN),
    // TWS 20 kn
    [0, 4.3, 6.4, 7.8, 9.4, 10.5, 10.8, 10.4, 8.8].map((v) => v * KN),
    // TWS 25 kn
    [0, 4.4, 6.5, 8.0, 9.8, 11.0, 11.4, 11.0, 9.2].map((v) => v * KN),
  ],
};

/**
 * Sail wardrobe — Model B (atomic sails). Each sail is one piece of canvas
 * with its own valid region on a fixed (TWS, TWA) grid. The skipper composes a
 * sail plan by picking one sail per category (headsail / main / downwind).
 */
export type SailCategory = 'headsail' | 'main' | 'downwind';
export const SAIL_CATEGORIES: readonly SailCategory[] = ['headsail', 'main', 'downwind'] as const;

export interface SailRegion {
  /** Grid cell keys "twsIdx,twaIdx" against the fixed grid in @g5000/core. */
  cells: string[];
}

export interface Sail {
  /** Stable unique id (e.g. 'j0', 'reef1', 'g0'). */
  id: string;
  /** Human-readable name (e.g. 'J0', 'Reef 1'). */
  name: string;
  category: SailCategory;
  /** Sail area in m² (optional; used to sort recommendations). */
  areaSqM?: number;
  notes?: string;
  region: SailRegion;
}

export interface SailWardrobe {
  /** Schema version. v3 = atomic sails. */
  schemaVersion: 3;
  boatId: BoatId;
  sails: Sail[];
  /** Currently hoisted sail in each category. All optional. */
  active: {
    headsail?: string;
    main?: string;
    downwind?: string;
  };
  /** Selects which polar revision is active for the boat. */
  activeMode: PolarMode;
}

/**
 * Per-channel damping configuration. Maps channel name → time constant in
 * seconds. A missing entry (or value of 0) means no damping is applied to
 * that channel.
 *
 * Used at the outgoing-client boundary (SSE writer, H-LINK V emit) to
 * low-pass-filter samples for display. Internal compute pipelines see raw
 * samples.
 */
export type DampingConfig = Record<string, number>;

/**
 * Default damping config: empty map. Users opt in to damping per channel via
 * the /damping UI page; nothing is smoothed by default.
 */
export const DEFAULT_DAMPING_CONFIG: DampingConfig = {};

/**
 * Source-priority arbitration rules. When two devices publish the same
 * channel (e.g. GPS over N2K and over 0183, two wind sensors, …), a selector
 * picks the highest-priority source whose last sample is younger than a
 * freshness window. The bus itself is unchanged — every source still
 * publishes. Compute pipelines opt in via `subscribeSelected`.
 *
 * See `@g5000/core` `selector.ts` for the matching rules.
 */
export interface SourcePriorityRule {
  /** Channel pattern (exact channel name or `wind.**`-style wildcard). */
  channelPattern: string;
  /**
   * Ordered list of source patterns. Lower index = higher priority.
   * Each entry matches against Sample.source either by exact equality or
   * by trailing-`*` prefix wildcard (e.g. `n2k:*`).
   */
  sources: string[];
  /**
   * Freshness window in seconds. If the preferred source hasn't published a
   * sample within this window, the selector falls through to the next source
   * in the list.
   */
  freshnessSeconds: number;
  /**
   * Sources to never select for this channel, even if all `sources` entries
   * are stale. Same pattern syntax as `sources`.
   */
  blocked?: string[];
}

export type SourcePriorityConfig = SourcePriorityRule[];

/**
 * Default source-priority config: empty array. With no rules, every channel
 * falls back to last-write-wins on the bus (current behaviour).
 */
export const DEFAULT_SOURCE_PRIORITY: SourcePriorityConfig = [];

/**
 * AIS CPA alarm configuration. The /chart page (and any future compute-side
 * alerter) reads this to decide whether to raise a collision-avoidance alarm
 * for a given AIS target.
 *
 * An alarm fires for a target iff `enabled` AND its CPA is < `cpaMeters`
 * AND its TCPA is positive (closing) AND < `tcpaSeconds`.
 */
export interface AisAlarmConfig {
  /** Master enable switch. When false, no targets are highlighted as threats. */
  enabled: boolean;
  /** CPA threshold in meters. Default 1852 m = 1 NM. */
  cpaMeters: number;
  /** TCPA threshold in seconds. Default 600 s = 10 min. Only positive (closing) TCPAs trip the alarm. */
  tcpaSeconds: number;
}

/** Default AIS alarm: ON, 1 NM, 10 min — sensible recreational defaults. */
export const DEFAULT_AIS_ALARM_CONFIG: AisAlarmConfig = {
  enabled: true,
  cpaMeters: 1852,
  tcpaSeconds: 600,
};

/**
 * Per-boat settings for the sail-crossover feature. Mode-agnostic.
 * The grid is fixed in @g5000/core; chart bounds are no longer stored here.
 */
export interface CrossoverSettings {
  recommendationStableSeconds: number;
  forecastIntervalMinutes: number;
  forecastDurationHours: number;
}

export const DEFAULT_CROSSOVER_SETTINGS: CrossoverSettings = {
  recommendationStableSeconds: 30,
  forecastIntervalMinutes: 30,
  forecastDurationHours: 12,
};

/**
 * Passage log — the maritime "log" (distance instrument). Persists a single
 * anchor timestamp; the /passage page sums over-ground distance from
 * `anchorAt` to now using the active track. The anchor is seeded on first
 * ConfigStore open with the current time, so the zero point is "the moment
 * this feature first ran on the boat". The user can re-anchor to now from
 * the UI.
 */
export interface PassageLog {
  /** UNIX seconds; null only in transient default-construction code paths. */
  anchorAt: number | null;
}

export const DEFAULT_WARDROBE: SailWardrobe = {
  schemaVersion: 3,
  boatId: 'sula',
  sails: [],
  active: {},
  activeMode: 'default',
};
