import { describe, it, expect } from 'vitest';
import { windCache, type WindGrid } from './wind-fetch';

function makeGrid(validAtSec: number, model: 'gfs' | 'ecmwf' = 'gfs', fh = 0): WindGrid {
  return {
    lats: [40, 41],
    lons: [-71, -70],
    u: [
      [0, 0],
      [0, 0],
    ],
    v: [
      [0, 0],
      [0, 0],
    ],
    validAt: validAtSec,
    runAt: validAtSec,
    forecastHour: fh,
    model,
  };
}

describe('PersistentWindCache.pruneStale', () => {
  it('removes entries whose validAt is older than (now - grace)', () => {
    windCache.clear();
    const now = 1_700_000_000_000;
    // Old: validAt 12 h before now (grace defaults to 6 h, so 12 h > grace → pruned)
    const oldKey = 'gfs|0|old';
    const freshKey = 'gfs|3|fresh';
    const futureKey = 'gfs|6|future';
    windCache.set(oldKey, { at: now, grid: makeGrid((now - 12 * 60 * 60_000) / 1000) });
    // Fresh: validAt 3 h before now (within 6 h grace → kept)
    windCache.set(freshKey, { at: now, grid: makeGrid((now - 3 * 60 * 60_000) / 1000) });
    // Future: validAt 6 h after now → kept
    windCache.set(futureKey, { at: now, grid: makeGrid((now + 6 * 60 * 60_000) / 1000) });

    const pruned = windCache.pruneStale(now);
    expect(pruned).toBe(1);
    expect(windCache.has(oldKey)).toBe(false);
    expect(windCache.has(freshKey)).toBe(true);
    expect(windCache.has(futureKey)).toBe(true);
    windCache.clear();
  });

  it('respects a custom grace window', () => {
    windCache.clear();
    const now = 1_700_000_000_000;
    const key = 'gfs|0|two-hours-old';
    windCache.set(key, { at: now, grid: makeGrid((now - 2 * 60 * 60_000) / 1000) });
    // 1 h grace → 2 h old is stale.
    expect(windCache.pruneStale(now, 60 * 60_000)).toBe(1);
    windCache.clear();
  });

  it('returns 0 when nothing is stale', () => {
    windCache.clear();
    const now = 1_700_000_000_000;
    windCache.set('gfs|0|fresh', { at: now, grid: makeGrid(now / 1000) });
    expect(windCache.pruneStale(now)).toBe(0);
    windCache.clear();
  });
});
