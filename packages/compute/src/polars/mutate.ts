import type { PolarTable } from '@g5000/db';

/**
 * Pure helpers for mutating PolarTable shape (adding/removing TWS rows or
 * TWA columns). All return a new PolarTable — callers should treat the
 * inputs as immutable.
 *
 * Constraints:
 *   - twsBins and twaBins must remain strictly increasing.
 *   - twaBins must stay within [0, π].
 *   - The table must remain at least MIN_BINS × MIN_BINS.
 *
 * The helpers throw on attempts that would violate these constraints. The UI
 * is expected to gate calls with confirmations and `canAddTwaBin` / friends.
 */

const KN = 0.514444;
const DEFAULT_TWS_STEP_KN = 4;
const DEFAULT_TWS_STEP_MS = DEFAULT_TWS_STEP_KN * KN;

/** Minimum number of bins in either axis. */
export const MIN_BINS = 3;

/** Maximum TWA bin in radians (180°). */
const TWA_MAX = Math.PI;

/** Smallest gap allowed when adding near the high TWA end (radians). ~0.5°. */
const TWA_GAP_EPSILON = (0.5 * Math.PI) / 180;

/**
 * Add a new TWA bin at the high-angle end. New bin centre is halfway between
 * the previous-last bin and π, unless that would round up to π itself in
 * which case we return null.
 *
 * Cell values for the new column are copied from the previous-last column.
 */
export function addTwaBin(polar: PolarTable): PolarTable {
  const last = polar.twaBins[polar.twaBins.length - 1];
  if (last === undefined) throw new Error('empty twaBins');
  if (!canAddTwaBin(polar)) {
    throw new Error(`cannot add TWA bin past π (last = ${(last * 180) / Math.PI}°)`);
  }
  const newBin = Math.min(TWA_MAX, last + (TWA_MAX - last) / 2);
  const newTwaBins = [...polar.twaBins, newBin];
  const prevIdx = polar.twaBins.length - 1;
  const newBoatSpeed = polar.boatSpeed.map((row) => [...row, row[prevIdx]!]);
  return { ...polar, twaBins: newTwaBins, boatSpeed: newBoatSpeed };
}

/** True if there's room for another TWA bin between the last bin and π. */
export function canAddTwaBin(polar: PolarTable): boolean {
  const last = polar.twaBins[polar.twaBins.length - 1];
  if (last === undefined) return false;
  return TWA_MAX - last > TWA_GAP_EPSILON;
}

/** Remove the TWA column at the given index. Errors if it would shrink below MIN_BINS. */
export function removeTwaBin(polar: PolarTable, twaIdx: number): PolarTable {
  if (twaIdx < 0 || twaIdx >= polar.twaBins.length) {
    throw new Error(`twaIdx ${twaIdx} out of range`);
  }
  if (polar.twaBins.length <= MIN_BINS) {
    throw new Error(`cannot shrink TWA bins below ${MIN_BINS}`);
  }
  const newTwaBins = polar.twaBins.filter((_, i) => i !== twaIdx);
  const newBoatSpeed = polar.boatSpeed.map((row) => row.filter((_, i) => i !== twaIdx));
  return { ...polar, twaBins: newTwaBins, boatSpeed: newBoatSpeed };
}

/**
 * Add a new TWS bin at the high-wind end. New bin centre = previous-last +
 * DEFAULT_TWS_STEP_MS. Cell values are copied from the previous-last row,
 * lightly scaled up by newTws / prevTws (clamped to 1.15× to avoid runaway
 * extrapolation).
 */
export function addTwsBin(polar: PolarTable): PolarTable {
  const last = polar.twsBins[polar.twsBins.length - 1];
  if (last === undefined) throw new Error('empty twsBins');
  const newBin = last + DEFAULT_TWS_STEP_MS;
  const scale = Math.min(1.15, newBin / last);
  const prevRow = polar.boatSpeed[polar.boatSpeed.length - 1]!;
  const newRow = prevRow.map((v) => v * scale);
  return {
    ...polar,
    twsBins: [...polar.twsBins, newBin],
    boatSpeed: [...polar.boatSpeed, newRow],
  };
}

/** Always allowed (no upper bound on TWS). */
export function canAddTwsBin(_polar: PolarTable): boolean {
  return true;
}

/** Remove the TWS row at the given index. Errors if it would shrink below MIN_BINS. */
export function removeTwsBin(polar: PolarTable, twsIdx: number): PolarTable {
  if (twsIdx < 0 || twsIdx >= polar.twsBins.length) {
    throw new Error(`twsIdx ${twsIdx} out of range`);
  }
  if (polar.twsBins.length <= MIN_BINS) {
    throw new Error(`cannot shrink TWS bins below ${MIN_BINS}`);
  }
  return {
    ...polar,
    twsBins: polar.twsBins.filter((_, i) => i !== twsIdx),
    boatSpeed: polar.boatSpeed.filter((_, i) => i !== twsIdx),
  };
}

/**
 * Set the boatSpeed value at a specific (twsIdx, twaIdx). Returns a new
 * PolarTable; throws if indices are out of range or value is non-finite.
 */
export function setCell(
  polar: PolarTable,
  twsIdx: number,
  twaIdx: number,
  newBsp: number,
): PolarTable {
  if (twsIdx < 0 || twsIdx >= polar.twsBins.length) {
    throw new Error(`twsIdx ${twsIdx} out of range`);
  }
  if (twaIdx < 0 || twaIdx >= polar.twaBins.length) {
    throw new Error(`twaIdx ${twaIdx} out of range`);
  }
  if (!Number.isFinite(newBsp)) throw new Error('newBsp must be finite');
  return {
    ...polar,
    boatSpeed: polar.boatSpeed.map((row, i) =>
      i === twsIdx ? row.map((v, j) => (j === twaIdx ? newBsp : v)) : row.slice(),
    ),
  };
}
