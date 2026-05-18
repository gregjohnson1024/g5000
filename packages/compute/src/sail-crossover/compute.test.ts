import { describe, expect, it } from 'vitest';
import {
  DEFAULT_WARDROBE_SETTINGS,
  type PolarTable,
  type SailWardrobe,
} from '@g5000/db';
import { computeCrossoverGrid } from './compute.js';

// Tiny polar helper: constant boat speed everywhere, for predictable tests.
function flatPolar(speed: number): PolarTable {
  return {
    twsBins: [0, 5, 10, 15, 20, 25, 30],
    twaBins: [Math.PI / 6, Math.PI / 4, Math.PI / 2, (3 * Math.PI) / 4, Math.PI],
    boatSpeed: [0, 5, 10, 15, 20, 25, 30].map(() => [speed, speed, speed, speed, speed]),
  };
}

describe('computeCrossoverGrid', () => {
  it('returns the only config as the winner everywhere when the wardrobe has one entry', () => {
    const w: SailWardrobe = {
      configs: [{ id: 'only', name: 'Only', polar: flatPolar(5) }],
      activeConfigId: 'only',
    };
    const grid = computeCrossoverGrid(w, DEFAULT_WARDROBE_SETTINGS);
    for (const row of grid.cells) {
      for (const cell of row) {
        expect(cell.winningConfigId).toBe('only');
        expect(cell.winningSpeedKn).toBeGreaterThan(0);
        expect(cell.runnerUpConfigId).toBe(null);
      }
    }
  });

  it('picks the faster config in a two-config wardrobe', () => {
    const w: SailWardrobe = {
      configs: [
        { id: 'slow', name: 'Slow', polar: flatPolar(3) },
        { id: 'fast', name: 'Fast', polar: flatPolar(7) },
      ],
      activeConfigId: 'slow',
    };
    const grid = computeCrossoverGrid(w, DEFAULT_WARDROBE_SETTINGS);
    for (const row of grid.cells) {
      for (const cell of row) {
        expect(cell.winningConfigId).toBe('fast');
        expect(cell.runnerUpConfigId).toBe('slow');
      }
    }
  });

  it('produces a grid sized by settings + step opts', () => {
    const w: SailWardrobe = {
      configs: [{ id: 'a', name: 'A', polar: flatPolar(5) }],
      activeConfigId: 'a',
    };
    const grid = computeCrossoverGrid(w, DEFAULT_WARDROBE_SETTINGS, {
      twsStepKn: 5,
      twaStepDeg: 30,
    });
    // TWS 0..30 step 5 → 7 bins; TWA 30..180 step 30 → 6 bins.
    expect(grid.twsBins.length).toBe(7);
    expect(grid.twaBins.length).toBe(6);
    expect(grid.cells.length).toBe(7);
    expect(grid.cells[0]!.length).toBe(6);
  });
});
