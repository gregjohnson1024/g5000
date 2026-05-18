/**
 * Fixed (TWS, TWA) grid for atomic-sail regions. Independent of polar bins;
 * sized to faithfully capture a North Sails-style crossover chart (1 kn × 5°).
 */

export const SAIL_GRID_TWS_STEP_KN = 1;
export const SAIL_GRID_TWS_MAX_KN = 40;
export const SAIL_GRID_TWS_BINS = SAIL_GRID_TWS_MAX_KN / SAIL_GRID_TWS_STEP_KN + 1; // 41

export const SAIL_GRID_TWA_STEP_DEG = 5;
export const SAIL_GRID_TWA_MAX_DEG = 180;
export const SAIL_GRID_TWA_BINS = SAIL_GRID_TWA_MAX_DEG / SAIL_GRID_TWA_STEP_DEG + 1; // 37

const MPS_PER_KN = 0.514444;
const RAD_TO_DEG = 180 / Math.PI;

export interface Cell {
  twsIdx: number;
  twaIdx: number;
}

export function snapToFixedGrid(input: { twsMs: number; twaRad: number }): Cell {
  const twsKn = input.twsMs / MPS_PER_KN;
  const twaDeg = input.twaRad * RAD_TO_DEG;
  const twsIdx = clamp(Math.round(twsKn / SAIL_GRID_TWS_STEP_KN), 0, SAIL_GRID_TWS_BINS - 1);
  const twaIdx = clamp(Math.round(twaDeg / SAIL_GRID_TWA_STEP_DEG), 0, SAIL_GRID_TWA_BINS - 1);
  return { twsIdx, twaIdx };
}

export function cellKey(cell: Cell): string {
  return `${cell.twsIdx},${cell.twaIdx}`;
}

export function parseCellKey(key: string): Cell | null {
  const [a, b] = key.split(',');
  const twsIdx = Number(a);
  const twaIdx = Number(b);
  if (!Number.isInteger(twsIdx) || !Number.isInteger(twaIdx)) return null;
  if (twsIdx < 0 || twsIdx >= SAIL_GRID_TWS_BINS) return null;
  if (twaIdx < 0 || twaIdx >= SAIL_GRID_TWA_BINS) return null;
  return { twsIdx, twaIdx };
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}
