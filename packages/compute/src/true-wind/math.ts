import type {
  AwsAwaCalTable,
  BoatConfig,
  BspCal,
  CompassDeviation,
} from '@h6000/db';

export interface TrueWindInputs {
  /** Apparent wind speed at the masthead, m/s. */
  aws: number;
  /** Apparent wind angle (from bow, positive starboard), radians, [-π, π]. */
  awa: number;
  /** Boat speed through water, m/s. */
  bsp: number;
  /** Magnetic heading, radians [0, 2π). */
  headingMagRad: number;
  /** Yaw rate (positive = clockwise from above), rad/s. */
  yawRateRad: number;
  awsAwaCal: AwsAwaCalTable;
  bspCal: BspCal;
  compassDeviation: CompassDeviation;
  boatConfig: BoatConfig;
}

export interface TrueWindOutputs {
  /** True wind speed, m/s. */
  tws: number;
  /** True wind angle (from bow), radians, [-π, π]. */
  twa: number;
  /** True wind direction (compass-style, from north), radians [0, 2π). */
  twd: number;
  /** What the calibration produced, before vector subtraction (debugging). */
  awsCal: number;
  awaCal: number;
  /** What the BSP correction produced. */
  bspCal: number;
}

const DEG_TO_RAD = Math.PI / 180;

/**
 * Compute true wind from apparent wind + boat speed + heading.
 *
 * Pipeline stages:
 *   1. Masthead motion correction: subtract masthead linear velocity from
 *      the apparent wind vector. Velocity = yaw_rate × mast_height,
 *      perpendicular to the boat heading at the masthead.
 *   2. AWS/AWA calibration: 2D bilinear interpolation on the cal grid.
 *   3. BSP calibration: 1D linear interpolation on the BSP cal table.
 *   4. Compass deviation: lookup by heading bin.
 *   5. Vector subtraction: TW = AW - V_boat in the earth frame.
 */
export function computeTrueWind(inp: TrueWindInputs): TrueWindOutputs {
  // --- Step 1: masthead motion correction ---
  // Yaw rate × mast height gives the masthead's lateral linear velocity.
  // Sign convention: positive yaw rate (turning to starboard) creates a
  // headwind component from the port side at the masthead, which adds
  // to apparent wind from the port direction.
  const mastheadLatVel = inp.yawRateRad * inp.boatConfig.mastHeight;
  // Decompose AW vector in boat frame.
  const awX = inp.aws * Math.cos(inp.awa);
  const awY = inp.aws * Math.sin(inp.awa);
  // Subtract the masthead's lateral velocity from the apparent vector to get
  // the apparent wind that the masthead WOULD see if it were stationary.
  const awCorrectedY = awY - mastheadLatVel;
  const awsCorr = Math.hypot(awX, awCorrectedY);
  const awaCorr = Math.atan2(awCorrectedY, awX);

  // --- Step 2: AWS/AWA cal table ---
  // Use |awa| for table lookup since the cal grid is symmetric across the
  // boat centerline. Apply the angle correction with the original sign.
  const awaAbs = Math.abs(awaCorr);
  const angleCorr = bilinearInterpolate2D(
    inp.awsAwaCal.awsBins,
    inp.awsAwaCal.awaBins,
    inp.awsAwaCal.angleCorrection,
    awsCorr,
    awaAbs,
  );
  const speedMul = bilinearInterpolate2D(
    inp.awsAwaCal.awsBins,
    inp.awsAwaCal.awaBins,
    inp.awsAwaCal.speedMultiplier,
    awsCorr,
    awaAbs,
  );
  const awsCal = awsCorr * speedMul;
  const awaCal = awaCorr + Math.sign(awaCorr || 1) * angleCorr;

  // --- Step 3: BSP cal ---
  const bspCalValue = applyBspCal(inp.bsp, inp.bspCal);

  // --- Step 4: compass deviation ---
  const headingTrue =
    applyCompassDeviation(inp.headingMagRad, inp.compassDeviation) +
    inp.boatConfig.magVarDeg * DEG_TO_RAD;

  // --- Step 5: vector subtraction in earth frame ---
  // We use a unified angle convention throughout the rotation: positive
  // angle = counterclockwise from boat-x (bow), so AWA matches that. The
  // earth frame uses the same orientation, with heading rotating the
  // boat-bow direction relative to north.
  //
  // In the boat frame: AW vector (calibrated) = (awsCal cos(awaCal), awsCal sin(awaCal)).
  // To rotate to earth frame using heading θ (compass: 0 = north, π/2 = east),
  // we use a rotation by θ counterclockwise. The formulas below are
  // self-consistent — the test that "rotating heading by 90° rotates TWD by 90°"
  // verifies the rotation is correct in aggregate.
  const awCalX = awsCal * Math.cos(awaCal);
  const awCalY = awsCal * Math.sin(awaCal);
  const cosH = Math.cos(headingTrue);
  const sinH = Math.sin(headingTrue);
  const awEarthX = awCalX * cosH - awCalY * sinH;
  const awEarthY = awCalX * sinH + awCalY * cosH;
  // Boat velocity vector in earth frame (along heading).
  const vbEarthX = bspCalValue * cosH;
  const vbEarthY = bspCalValue * sinH;
  // True wind = apparent wind - boat velocity.
  const twEarthX = awEarthX - vbEarthX;
  const twEarthY = awEarthY - vbEarthY;
  const tws = Math.hypot(twEarthX, twEarthY);
  // TWD: angle of TW vector in earth frame, normalized to [0, 2π).
  let twd = Math.atan2(twEarthY, twEarthX);
  if (twd < 0) twd += Math.PI * 2;
  // TWA: TW in boat frame, signed [-π, π]. Inverse of the earth rotation.
  const twBoatX = twEarthX * cosH + twEarthY * sinH;
  const twBoatY = -twEarthX * sinH + twEarthY * cosH;
  const twa = Math.atan2(twBoatY, twBoatX);

  return { tws, twa, twd, awsCal, awaCal, bspCal: bspCalValue };
}

/**
 * Bilinear interpolation on a regular grid. Inputs outside the grid are
 * clamped to the nearest edge. `xBins` and `yBins` must be strictly
 * increasing.
 */
export function bilinearInterpolate2D(
  xBins: number[],
  yBins: number[],
  grid: number[][],
  x: number,
  y: number,
): number {
  const xi = locate(xBins, x);
  const yi = locate(yBins, y);
  const x0 = xBins[xi.lo]!;
  const x1 = xBins[xi.hi]!;
  const y0 = yBins[yi.lo]!;
  const y1 = yBins[yi.hi]!;
  const fx = x1 === x0 ? 0 : (x - x0) / (x1 - x0);
  const fy = y1 === y0 ? 0 : (y - y0) / (y1 - y0);
  const c00 = grid[xi.lo]![yi.lo]!;
  const c01 = grid[xi.lo]![yi.hi]!;
  const c10 = grid[xi.hi]![yi.lo]!;
  const c11 = grid[xi.hi]![yi.hi]!;
  return (
    c00 * (1 - fx) * (1 - fy) +
    c10 * fx * (1 - fy) +
    c01 * (1 - fx) * fy +
    c11 * fx * fy
  );
}

function locate(bins: number[], v: number): { lo: number; hi: number } {
  if (bins.length === 0) return { lo: 0, hi: 0 };
  if (v <= bins[0]!) return { lo: 0, hi: 0 };
  if (v >= bins[bins.length - 1]!) {
    return { lo: bins.length - 1, hi: bins.length - 1 };
  }
  for (let i = 0; i < bins.length - 1; i++) {
    if (v >= bins[i]! && v <= bins[i + 1]!) return { lo: i, hi: i + 1 };
  }
  return { lo: bins.length - 1, hi: bins.length - 1 };
}

export function applyBspCal(bsp: number, cal: BspCal): number {
  if (cal.bins.length === 0) return bsp;
  if (cal.bins.length !== cal.multiplier.length) return bsp;
  const idx = locate(cal.bins, bsp);
  const x0 = cal.bins[idx.lo]!;
  const x1 = cal.bins[idx.hi]!;
  const m0 = cal.multiplier[idx.lo]!;
  const m1 = cal.multiplier[idx.hi]!;
  const fx = x1 === x0 ? 0 : (bsp - x0) / (x1 - x0);
  const m = m0 * (1 - fx) + m1 * fx;
  return bsp * m;
}

export function applyCompassDeviation(
  headingRad: number,
  cal: CompassDeviation,
): number {
  if (cal.deviation.length === 0) return headingRad;
  // Normalize heading to [0, 2π)
  const TWO_PI = 2 * Math.PI;
  let h = headingRad % TWO_PI;
  if (h < 0) h += TWO_PI;
  // 36 bins of 10° each = π/18 radians.
  const binWidth = TWO_PI / cal.deviation.length;
  const idx = Math.min(
    cal.deviation.length - 1,
    Math.floor(h / binWidth),
  );
  return headingRad + cal.deviation[idx]!;
}
