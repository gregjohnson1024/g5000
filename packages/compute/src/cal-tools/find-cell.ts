import type { AwsAwaCalTable } from '@h6000/db';

export interface CellIndex {
  awsIdx: number;
  awaIdx: number;
}

/**
 * Return the indices of the cal cell whose bin centers are closest to
 * the given AWS / |AWA|. Snap-to-nearest, not interpolating — when the
 * wizard applies a correction to "the cell at AWS=5.4, |AWA|=50°", the
 * user sees one specific cell change rather than four cells weighted.
 *
 * `awaAbs` is expected to already be non-negative (callers should pass
 * Math.abs(awa)). The cal grid is symmetric across the boat centerline.
 */
export function findNearestCalCell(
  cal: AwsAwaCalTable,
  aws: number,
  awaAbs: number,
): CellIndex {
  return {
    awsIdx: nearestIndex(cal.awsBins, aws),
    awaIdx: nearestIndex(cal.awaBins, awaAbs),
  };
}

function nearestIndex(bins: number[], v: number): number {
  if (bins.length === 0) return 0;
  if (v <= bins[0]!) return 0;
  if (v >= bins[bins.length - 1]!) return bins.length - 1;
  let bestIdx = 0;
  let bestDist = Math.abs(v - bins[0]!);
  for (let i = 1; i < bins.length; i++) {
    const d = Math.abs(v - bins[i]!);
    if (d < bestDist) {
      bestDist = d;
      bestIdx = i;
    }
  }
  return bestIdx;
}

/**
 * Return a new cal table with one cell's angle correction incremented
 * by `delta`. The input table is not mutated.
 */
export function applyAngleCorrectionToCell(
  cal: AwsAwaCalTable,
  cell: CellIndex,
  delta: number,
): AwsAwaCalTable {
  if (
    cell.awsIdx < 0 ||
    cell.awsIdx >= cal.awsBins.length ||
    cell.awaIdx < 0 ||
    cell.awaIdx >= cal.awaBins.length
  ) {
    throw new Error(
      `applyAngleCorrectionToCell: cell index out of range ` +
        `(awsIdx=${cell.awsIdx}/${cal.awsBins.length}, awaIdx=${cell.awaIdx}/${cal.awaBins.length})`,
    );
  }
  const newAngleCorr = cal.angleCorrection.map((row) => row.slice());
  newAngleCorr[cell.awsIdx]![cell.awaIdx]! += delta;
  return {
    ...cal,
    angleCorrection: newAngleCorr,
  };
}
