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
