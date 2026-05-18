import type { SailWardrobe, WardrobeSettings } from '@g5000/db';
import { interpolatePolarSpeed } from '../polars/math.js';

export interface CrossoverCell {
  winningConfigId: string | null;
  winningSpeedKn: number | null;
  runnerUpConfigId: string | null;
  runnerUpSpeedKn: number | null;
}

export interface CrossoverGrid {
  twsBins: number[];
  twaBins: number[];
  cells: CrossoverCell[][];
}

export interface CrossoverOpts {
  twsStepKn?: number;
  twaStepDeg?: number;
}

const KN_TO_MS = 0.514444;
const DEG_TO_RAD = Math.PI / 180;
const MS_TO_KN = 1 / KN_TO_MS;

/**
 * For each (TWS, TWA) bin in the configured chart range, interpolate every
 * wardrobe config's polar and pick the fastest. Sharp boundaries — hysteresis
 * is a presentation/recommendation concern, not a grid-coloring one.
 *
 * Pure. Fast. ~30 × 30 × 5 configs ≈ 4500 lookups; well under 10 ms.
 */
export function computeCrossoverGrid(
  wardrobe: SailWardrobe,
  settings: WardrobeSettings,
  opts: CrossoverOpts = {},
): CrossoverGrid {
  const twsStep = opts.twsStepKn ?? 1;
  const twaStep = opts.twaStepDeg ?? 5;

  const twsBins: number[] = [];
  for (let v = 0; v <= settings.chartTwsMaxKn + 1e-9; v += twsStep) {
    twsBins.push(Number(v.toFixed(4)));
  }
  const twaBins: number[] = [];
  for (let v = settings.chartTwaMinDeg; v <= settings.chartTwaMaxDeg + 1e-9; v += twaStep) {
    twaBins.push(Number(v.toFixed(4)));
  }

  const cells: CrossoverCell[][] = twsBins.map((twsKn) =>
    twaBins.map((twaDeg) => {
      const twsMs = twsKn * KN_TO_MS;
      const twaRad = twaDeg * DEG_TO_RAD;
      let best: { id: string; kn: number } | null = null;
      let second: { id: string; kn: number } | null = null;
      for (const c of wardrobe.configs) {
        const bspMs = interpolatePolarSpeed(c.polar, twsMs, twaRad);
        if (!Number.isFinite(bspMs) || bspMs <= 0) continue;
        const kn = bspMs * MS_TO_KN;
        if (!best || kn > best.kn) {
          second = best;
          best = { id: c.id, kn };
        } else if (!second || kn > second.kn) {
          second = { id: c.id, kn };
        }
      }
      return {
        winningConfigId: best?.id ?? null,
        winningSpeedKn: best?.kn ?? null,
        runnerUpConfigId: second?.id ?? null,
        runnerUpSpeedKn: second?.kn ?? null,
      };
    }),
  );

  return { twsBins, twaBins, cells };
}
