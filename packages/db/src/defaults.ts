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
  bins: [0, 1, 2, 3, 4, 5, 6, 8, 10, 12], // m/s
  multiplier: Array.from({ length: 10 }, () => 1.0),
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
}

/**
 * Baseline catamaran-ish polar. Values are deliberately rough — the user is
 * expected to import their own polar via CSV before performance numbers are
 * trustworthy. Shape: 8 TWS bins × 9 TWA bins.
 *
 * Boat speeds chosen to roughly resemble a 40' sport catamaran in displacement
 * mode. Real boats vary widely.
 */
const DEG = Math.PI / 180;
export const DEFAULT_POLARS: PolarTable = {
  twsBins: [2, 4, 6, 8, 10, 12, 16, 20], // m/s ≈ 4, 8, 12, 16, 20, 23, 31, 39 kn
  twaBins: [
    0 * DEG,
    30 * DEG,
    45 * DEG,
    60 * DEG,
    90 * DEG,
    120 * DEG,
    135 * DEG,
    150 * DEG,
    180 * DEG,
  ],
  // Rows = TWS (low to high), cols = TWA (0=in-irons, π=dead-down).
  boatSpeed: [
    // TWS 2 m/s (~4 kn)
    [0, 0.8, 1.3, 1.6, 1.6, 1.4, 1.2, 0.9, 0.4],
    // TWS 4 m/s (~8 kn)
    [0, 1.8, 2.7, 3.2, 3.4, 3.3, 3.0, 2.6, 1.6],
    // TWS 6 m/s (~12 kn)
    [0, 3.0, 4.3, 5.0, 5.4, 5.6, 5.4, 5.0, 3.4],
    // TWS 8 m/s (~16 kn)
    [0, 4.0, 5.6, 6.4, 7.0, 7.4, 7.4, 7.1, 5.4],
    // TWS 10 m/s (~20 kn)
    [0, 4.5, 6.4, 7.2, 8.1, 8.7, 8.9, 8.6, 6.8],
    // TWS 12 m/s (~23 kn)
    [0, 4.8, 6.9, 7.8, 8.9, 9.7, 10.0, 9.7, 7.8],
    // TWS 16 m/s (~31 kn)
    [0, 5.0, 7.2, 8.3, 9.7, 10.7, 11.0, 10.8, 8.8],
    // TWS 20 m/s (~39 kn)
    [0, 5.0, 7.3, 8.5, 10.0, 11.1, 11.4, 11.2, 9.0],
  ],
};

/**
 * One sail-configuration entry in the wardrobe. Carries its own polar table
 * plus metadata so the user knows which configuration they're picking.
 */
export interface SailConfig {
  /** Stable unique ID (e.g. 'default', 'full-j1', 'reef1-a2'). */
  id: string;
  /** Human-readable name (e.g. 'Full main + J1'). */
  name: string;
  /** Optional structured metadata for filtering / sorting. */
  mainState?: string;
  headsail?: string;
  downwindSail?: string;
  notes?: string;
  /** This config's polar table. */
  polar: PolarTable;
}

/**
 * The sail wardrobe: list of configurations + which one is currently active.
 * The compute pipeline reads the active config's polar.
 */
export interface SailWardrobe {
  configs: SailConfig[];
  /** ID of the active configuration. Must reference a configs[].id. */
  activeConfigId: string;
}

/** Default wardrobe: one config wrapping the existing DEFAULT_POLARS. */
export const DEFAULT_WARDROBE: SailWardrobe = {
  configs: [
    {
      id: 'default',
      name: 'Default',
      notes: 'Initial baseline polar. Replace with your boat-specific data.',
      polar: DEFAULT_POLARS,
    },
  ],
  activeConfigId: 'default',
};
