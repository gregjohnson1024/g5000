import { describe, it, expect } from 'vitest';
import {
  addTwaBin,
  addTwsBin,
  canAddTwaBin,
  canAddTwsBin,
  MIN_BINS,
  removeTwaBin,
  removeTwsBin,
  setCell,
} from './mutate.js';
import { DEFAULT_POLARS, type PolarTable } from '@g5000/db';

// A small synthetic polar without a 180° terminal bin so we can test "add at end".
const SMALL: PolarTable = {
  twsBins: [3, 5, 7, 9],
  twaBins: [0, (Math.PI * 30) / 180, (Math.PI * 60) / 180, (Math.PI * 90) / 180],
  boatSpeed: [
    [0, 1, 2, 3],
    [0, 1.5, 2.5, 3.5],
    [0, 2, 3, 4],
    [0, 2.5, 3.5, 4.5],
  ],
};

describe('addTwaBin', () => {
  it('extends the column count and keeps row shapes consistent', () => {
    const out = addTwaBin(SMALL);
    expect(out.twaBins).toHaveLength(SMALL.twaBins.length + 1);
    expect(out.boatSpeed).toHaveLength(SMALL.twsBins.length);
    for (const row of out.boatSpeed) {
      expect(row).toHaveLength(out.twaBins.length);
    }
  });

  it('new bin is between previous-last and π', () => {
    const out = addTwaBin(SMALL);
    const prevLast = SMALL.twaBins[SMALL.twaBins.length - 1]!;
    const newLast = out.twaBins[out.twaBins.length - 1]!;
    expect(newLast).toBeGreaterThan(prevLast);
    expect(newLast).toBeLessThanOrEqual(Math.PI);
  });

  it('keeps twaBins strictly increasing', () => {
    const out = addTwaBin(SMALL);
    for (let i = 1; i < out.twaBins.length; i++) {
      expect(out.twaBins[i]!).toBeGreaterThan(out.twaBins[i - 1]!);
    }
  });

  it('refuses to add when the previous-last bin is already π', () => {
    expect(canAddTwaBin(DEFAULT_POLARS)).toBe(false);
    expect(() => addTwaBin(DEFAULT_POLARS)).toThrow();
  });
});

describe('removeTwaBin', () => {
  it('drops the indicated column', () => {
    const out = removeTwaBin(SMALL, 1);
    expect(out.twaBins).toHaveLength(SMALL.twaBins.length - 1);
    for (const row of out.boatSpeed) {
      expect(row).toHaveLength(SMALL.twaBins.length - 1);
    }
    // First TWS row originally [0, 1, 2, 3] minus col 1 → [0, 2, 3]
    expect(out.boatSpeed[0]).toEqual([0, 2, 3]);
  });

  it('refuses to shrink below MIN_BINS', () => {
    let p: PolarTable = SMALL;
    // SMALL has 4 TWA bins; drop down to MIN_BINS
    while (p.twaBins.length > MIN_BINS) {
      p = removeTwaBin(p, p.twaBins.length - 1);
    }
    expect(p.twaBins).toHaveLength(MIN_BINS);
    expect(() => removeTwaBin(p, 0)).toThrow();
  });

  it('throws on out-of-range index', () => {
    expect(() => removeTwaBin(SMALL, -1)).toThrow();
    expect(() => removeTwaBin(SMALL, 99)).toThrow();
  });
});

describe('addTwsBin', () => {
  it('extends the row count by one', () => {
    const out = addTwsBin(SMALL);
    expect(out.twsBins).toHaveLength(SMALL.twsBins.length + 1);
    expect(out.boatSpeed).toHaveLength(SMALL.twsBins.length + 1);
  });

  it('new TWS bin is higher than the previous-last', () => {
    const out = addTwsBin(SMALL);
    const prevLast = SMALL.twsBins[SMALL.twsBins.length - 1]!;
    const newLast = out.twsBins[out.twsBins.length - 1]!;
    expect(newLast).toBeGreaterThan(prevLast);
  });

  it('new row has the same column count as twaBins', () => {
    const out = addTwsBin(SMALL);
    expect(out.boatSpeed[out.boatSpeed.length - 1]!).toHaveLength(SMALL.twaBins.length);
  });

  it('canAddTwsBin is true for default polar', () => {
    expect(canAddTwsBin(DEFAULT_POLARS)).toBe(true);
  });
});

describe('removeTwsBin', () => {
  it('drops the indicated row', () => {
    const out = removeTwsBin(SMALL, 1);
    expect(out.twsBins).toHaveLength(SMALL.twsBins.length - 1);
    expect(out.boatSpeed).toHaveLength(SMALL.twsBins.length - 1);
  });

  it('refuses to shrink below MIN_BINS', () => {
    let p: PolarTable = SMALL;
    while (p.twsBins.length > MIN_BINS) {
      p = removeTwsBin(p, p.twsBins.length - 1);
    }
    expect(() => removeTwsBin(p, 0)).toThrow();
  });
});

describe('setCell', () => {
  it('updates only the targeted cell', () => {
    const out = setCell(SMALL, 1, 2, 99);
    expect(out.boatSpeed[1]![2]).toBe(99);
    expect(out.boatSpeed[0]).toEqual(SMALL.boatSpeed[0]);
    expect(out.boatSpeed[1]![0]).toBe(SMALL.boatSpeed[1]![0]);
  });

  it('throws on out-of-range', () => {
    expect(() => setCell(SMALL, -1, 0, 1)).toThrow();
    expect(() => setCell(SMALL, 0, -1, 1)).toThrow();
    expect(() => setCell(SMALL, 99, 0, 1)).toThrow();
    expect(() => setCell(SMALL, 0, 99, 1)).toThrow();
  });

  it('throws on non-finite values', () => {
    expect(() => setCell(SMALL, 0, 0, NaN)).toThrow();
    expect(() => setCell(SMALL, 0, 0, Infinity)).toThrow();
  });
});
