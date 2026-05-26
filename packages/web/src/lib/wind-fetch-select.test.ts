import { describe, it, expect } from 'vitest';
import { selectConsistentGrids } from './wind-fetch.js';
import type { WindGrid } from './wind-fetch.js';

/** Minimal 2×2 WindGrid for a given run, forecast hour, and extent. */
function mk(
  runAt: number,
  forecastHour: number,
  extent: [number, number, number, number],
): WindGrid {
  const [lat0, latN, lon0, lonN] = extent;
  return {
    lats: [lat0, latN],
    lons: [lon0, lonN],
    u: [
      [1, 1],
      [1, 1],
    ],
    v: [
      [0, 0],
      [0, 0],
    ],
    validAt: runAt + forecastHour * 3600,
    runAt,
    forecastHour,
    model: 'gfs',
  };
}

const A: [number, number, number, number] = [34, 42, -72, -64];
const B: [number, number, number, number] = [30, 38, -70, -62];

describe('selectConsistentGrids', () => {
  it('returns [] for empty input', () => {
    expect(selectConsistentGrids([])).toEqual([]);
  });

  it('prefers the most recent run even when an older run has more hours', () => {
    const oldRun = [mk(1000, 0, A), mk(1000, 3, A), mk(1000, 6, A)]; // 3 hours
    const newRun = [mk(20000, 0, A), mk(20000, 3, A)]; // 2 hours, newer
    const out = selectConsistentGrids([...oldRun, ...newRun]);
    expect(out.length).toBe(2);
    expect(out.every((g) => g.runAt === 20000)).toBe(true);
  });

  it('never mixes two extents of the same dimensions (same run)', () => {
    const extentA = [mk(1000, 0, A), mk(1000, 3, A), mk(1000, 6, A)]; // 3 hours
    const extentB = [mk(1000, 0, B), mk(1000, 3, B)]; // 2 hours
    const out = selectConsistentGrids([...extentA, ...extentB]);
    expect(out.length).toBe(3);
    expect(out.every((g) => g.lats[0] === A[0] && g.lats[1] === A[1])).toBe(true);
  });

  it('sorts by valid time and dedupes duplicate valid times', () => {
    const grids = [mk(1000, 6, A), mk(1000, 0, A), mk(1000, 3, A), mk(1000, 3, A)];
    const out = selectConsistentGrids(grids);
    expect(out.map((g) => g.forecastHour)).toEqual([0, 3, 6]);
  });
});
