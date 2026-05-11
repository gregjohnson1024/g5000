import type { AwsAwaCalTable } from '@h6000/db';
import { findNearestCalCell, applyAngleCorrectionToCell, type CellIndex } from './find-cell.js';

/**
 * One steady-state capture during the tack-test wizard.
 */
export interface TackCapture {
  /** True wind direction (compass-style from north), radians [0, 2π). */
  twd: number;
  /** True wind speed, m/s. */
  tws: number;
  /** Apparent wind angle (signed, from bow), radians. */
  awa: number;
  /** Apparent wind speed, m/s. */
  aws: number;
}

export interface TackCorrectionResult {
  cell: CellIndex;
  /** Angle correction delta in radians (to be ADDED to the cell's current value). */
  delta: number;
  /** A preview of the cal table with the delta applied — for displaying before/after. */
  previewed: AwsAwaCalTable;
  /** TWD difference between tacks, after wrap normalization, radians. */
  twdDiff: number;
}

/**
 * Compute the cal-cell correction needed to make two tack captures agree on TWD.
 *
 *   twdDiff = signed shortest arc from starboard TWD to port TWD (with sign
 *             determined by the raw numeric difference, not the modular direction)
 *   delta   = -twdDiff / 2
 *
 * The cell is found from the port capture's AWS and |AWA| (snap-to-nearest).
 */
export function computeTackCorrection(
  cal: AwsAwaCalTable,
  port: TackCapture,
  starboard: TackCapture,
): TackCorrectionResult {
  const twdDiff = wrapToPi(port.twd, starboard.twd);
  const delta = -twdDiff / 2;
  const cell = findNearestCalCell(cal, port.aws, Math.abs(port.awa));
  const previewed = applyAngleCorrectionToCell(cal, cell, delta);
  return { cell, delta, previewed, twdDiff };
}

/**
 * Return the signed shortest-arc difference (port.twd - stbd.twd), where
 * the sign is determined by which is numerically larger (not by modular
 * direction). Result is in (-π, π].
 *
 * This correctly handles the 0/2π wraparound: when port=358° and stbd=2°,
 * the short arc is 4° and port is numerically larger, so the result is +4°.
 */
function wrapToPi(portTwd: number, stbdTwd: number): number {
  const rawDiff = portTwd - stbdTwd;
  const twoPi = 2 * Math.PI;
  const w2pi = ((rawDiff % twoPi) + twoPi) % twoPi;
  const shortArc = w2pi > Math.PI ? twoPi - w2pi : w2pi;
  return rawDiff >= 0 ? shortArc : -shortArc;
}
