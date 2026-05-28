import { describe, it, expect } from 'vitest';
import {
  gridMatchesBbox,
  gridExtentKey,
  findReusableGrid,
  CMEMS_BBOX_TOL,
  type CurrentGrid,
} from './current-fetch';

function makeGrid(
  ext: { latMin: number; latMax: number; lonMin: number; lonMax: number },
  opts: { forecastDay?: number; validAt?: number } = {},
): CurrentGrid {
  return {
    lats: [ext.latMin, (ext.latMin + ext.latMax) / 2, ext.latMax],
    lons: [ext.lonMin, (ext.lonMin + ext.lonMax) / 2, ext.lonMax],
    u: [
      [0, 0, 0],
      [0, 0, 0],
      [0, 0, 0],
    ],
    v: [
      [0, 0, 0],
      [0, 0, 0],
      [0, 0, 0],
    ],
    validAt: opts.validAt ?? 1_700_000_000,
    runAt: opts.validAt ?? 1_700_000_000,
    forecastDay: opts.forecastDay ?? 0,
    source: 'CMEMS',
  };
}

describe('gridMatchesBbox', () => {
  const grid = makeGrid({ latMin: 34.0, latMax: 39.0, lonMin: -73.0, lonMax: -66.0 });

  it('matches when the grid extent is within tolerance of the requested bbox', () => {
    // Within one CMEMS cell (~0.083°) of the grid extent on every edge.
    expect(
      gridMatchesBbox(grid, { latMin: 34.05, latMax: 38.94, lonMin: -73.04, lonMax: -66.05 }),
    ).toBe(true);
  });

  it('does not match when an edge is beyond tolerance', () => {
    // latMin off by 0.5° — well past the 0.25° tolerance.
    expect(
      gridMatchesBbox(grid, { latMin: 34.5, latMax: 39.0, lonMin: -73.0, lonMax: -66.0 }),
    ).toBe(false);
  });
});

describe('gridExtentKey', () => {
  it('derives the key from the grid actual extent (not any requested bbox)', () => {
    // CMEMS-snapped extent (1/12° grid) — what the grid actually covers.
    const grid = makeGrid({
      latMin: 34.41667,
      latMax: 39.33333,
      lonMin: -73.58333,
      lonMax: -66.58333,
    });
    expect(gridExtentKey(grid, '2026-05-26')).toBe('cmems|2026-05-26|34.42|39.33|-73.58|-66.58');
  });

  it('produces an identical key for two grids with the same extent, regardless of request', () => {
    // The two real-world near-duplicate requests (0.01° apart in latMin) returned
    // byte-identical grids; keyed on extent they collapse to one entry.
    const a = makeGrid({
      latMin: 34.41667,
      latMax: 39.33333,
      lonMin: -73.58333,
      lonMax: -66.58333,
    });
    const b = makeGrid({
      latMin: 34.41667,
      latMax: 39.33333,
      lonMin: -73.58333,
      lonMax: -66.58333,
    });
    expect(gridExtentKey(a, '2026-05-26')).toBe(gridExtentKey(b, '2026-05-26'));
  });
});

describe('findReusableGrid', () => {
  const V = 1_700_000_000;
  const cached = makeGrid(
    { latMin: 34.41667, latMax: 39.33333, lonMin: -73.58333, lonMax: -66.58333 },
    { forecastDay: 0, validAt: V },
  );

  it('reuses a cached grid for a jittered bbox (same day, extent within tolerance)', () => {
    // A 0.01° drag — the case that currently mints a fresh key and re-fetches.
    const jittered = { latMin: 34.42, latMax: 39.34, lonMin: -73.59, lonMax: -66.59 };
    expect(findReusableGrid([cached], jittered, 0, V)).toBe(cached);
  });

  it('returns null when the requested bbox is beyond tolerance', () => {
    const faraway = { latMin: 10.0, latMax: 15.0, lonMin: -40.0, lonMax: -35.0 };
    expect(findReusableGrid([cached], faraway, 0, V)).toBeNull();
  });

  it('returns null when the forecast day differs', () => {
    const sameBox = { latMin: 34.42, latMax: 39.34, lonMin: -73.59, lonMax: -66.59 };
    expect(findReusableGrid([cached], sameBox, 1, V)).toBeNull();
  });

  it('returns null when the represented day (validAt) differs — no stale reuse', () => {
    const sameBox = { latMin: 34.42, latMax: 39.34, lonMin: -73.59, lonMax: -66.59 };
    const yesterday = V - 24 * 60 * 60;
    expect(findReusableGrid([cached], sameBox, 0, yesterday)).toBeNull();
  });
});

describe('CMEMS_BBOX_TOL', () => {
  it('is at least two CMEMS cells so snapping never causes a self-miss', () => {
    // CMEMS grid is 1/12° ≈ 0.0833°. Tolerance must comfortably exceed it.
    expect(CMEMS_BBOX_TOL).toBeGreaterThanOrEqual(2 / 12);
  });
});
