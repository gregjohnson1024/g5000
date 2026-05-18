import type { CrossoverMap, PolarTable } from '@g5000/db';

const TAU = Math.PI * 2;

function foldTwa(twa: number): number {
  // Map any real TWA to [0, π] using port/starboard symmetry.
  let t = ((twa % TAU) + TAU) % TAU;
  if (t > Math.PI) t = TAU - t;
  return t;
}

function nearestBinIdx(bins: number[], value: number): number {
  if (bins.length === 0) return 0;
  if (value <= bins[0]!) return 0;
  if (value >= bins[bins.length - 1]!) return bins.length - 1;
  let best = 0;
  let bestErr = Math.abs(value - bins[0]!);
  for (let i = 1; i < bins.length; i++) {
    const e = Math.abs(value - bins[i]!);
    if (e < bestErr) {
      best = i;
      bestErr = e;
    }
  }
  return best;
}

export interface Cell {
  twsIdx: number;
  twaIdx: number;
}

export function snapToCell(polar: PolarTable, twsMs: number, twaRad: number): Cell {
  return {
    twsIdx: nearestBinIdx(polar.twsBins, twsMs),
    twaIdx: nearestBinIdx(polar.twaBins, foldTwa(twaRad)),
  };
}

export function lookupConfigId(
  map: CrossoverMap,
  polar: PolarTable,
  twsMs: number,
  twaRad: number,
): string | null {
  const { twsIdx, twaIdx } = snapToCell(polar, twsMs, twaRad);
  return map.cells[`${twsIdx},${twaIdx}`] ?? null;
}
