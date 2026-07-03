import type {
  AwsAwaCalTable,
  BoatConfig,
  BspCal,
  CompassDeviation,
  WindMisalignmentCal,
} from '@g5000/db';
// `bilinearInterpolate2D` and `locate` live in the shared grid-interp module.
// Re-exported here so existing importers of this module (and the package
// barrel's `export *`) keep seeing `bilinearInterpolate2D` unchanged.
export { bilinearInterpolate2D, locate } from '../grid-interp.js';
import { bilinearInterpolate2D, locate } from '../grid-interp.js';

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
  /** Heel angle, radians (signed). Heel correction is skipped when absent
   *  or when boatConfig.heelCorrectionEnabled is not set. */
  heel?: number | null;
  /** Per-AWS-bin sensor-misalignment cal. Skipped when absent. */
  misalignmentCal?: WindMisalignmentCal | null;
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
 *   1b. Heel correction (opt-in): project the mast-plane vane measurement
 *      back to the horizontal plane.
 *   1c. Sensor-misalignment offset (opt-in): signed AWA offset interpolated
 *      on AWS, applied identically on both tacks.
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
  let awsCorr = Math.hypot(awX, awCorrectedY);
  let awaCorr = Math.atan2(awCorrectedY, awX);

  // --- Step 1b: heel correction (opt-in) ---
  // The masthead vane measures the wind in the plane perpendicular to the
  // mast. When the boat heels by φ, the horizontal wind's athwartships
  // component is foreshortened by cos(φ) in that plane while the fore-aft
  // component (along the heel axis) is unchanged. So the mast-plane
  // measurement relates to the horizontal wind by
  //   awa_h = atan2(sin(awa)·cos(φ), cos(awa))
  //   aws_h = aws·sqrt(cos²(awa) + sin²(awa)·cos²(φ))
  // atan2 of the scaled components preserves the sign/quadrant of awa.
  // Skipped entirely (outputs bit-identical to before this stage existed)
  // unless explicitly enabled AND a heel sample is present.
  if (inp.boatConfig.heelCorrectionEnabled && inp.heel != null) {
    const cosHeel = Math.cos(inp.heel);
    const sinAwa = Math.sin(awaCorr);
    const cosAwa = Math.cos(awaCorr);
    awaCorr = Math.atan2(sinAwa * cosHeel, cosAwa);
    awsCorr = awsCorr * Math.sqrt(cosAwa * cosAwa + sinAwa * sinAwa * cosHeel * cosHeel);
  }

  // --- Step 1c: sensor-misalignment offset (opt-in) ---
  // Signed AWA offset (same sign on both tacks) interpolated on AWS — AWS is
  // used as the key because TWS isn't known until after the vector
  // subtraction. Skipped entirely when no cal is configured.
  if (inp.misalignmentCal && inp.misalignmentCal.awsBins.length > 0) {
    awaCorr = awaCorr + applyMisalignmentCal(awsCorr, inp.misalignmentCal);
  }

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
 * Signed AWA offset (radians) for the given AWS: 1D linear interpolation on
 * the cal's AWS bins, clamped at both ends. Returns 0 for an empty or
 * shape-mismatched cal.
 */
export function applyMisalignmentCal(aws: number, cal: WindMisalignmentCal): number {
  if (cal.awsBins.length === 0) return 0;
  if (cal.awsBins.length !== cal.awaOffsetRad.length) return 0;
  const idx = locate(cal.awsBins, aws);
  const x0 = cal.awsBins[idx.lo]!;
  const x1 = cal.awsBins[idx.hi]!;
  const y0 = cal.awaOffsetRad[idx.lo]!;
  const y1 = cal.awaOffsetRad[idx.hi]!;
  const fx = x1 === x0 ? 0 : (aws - x0) / (x1 - x0);
  return y0 * (1 - fx) + y1 * fx;
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

export function applyCompassDeviation(headingRad: number, cal: CompassDeviation): number {
  if (cal.deviation.length === 0) return headingRad;
  // Normalize heading to [0, 2π)
  const TWO_PI = 2 * Math.PI;
  let h = headingRad % TWO_PI;
  if (h < 0) h += TWO_PI;
  // 36 bins of 10° each = π/18 radians.
  const binWidth = TWO_PI / cal.deviation.length;
  const idx = Math.min(cal.deviation.length - 1, Math.floor(h / binWidth));
  return headingRad + cal.deviation[idx]!;
}
