import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { WindGrid } from './wind-fetch.js';

// The module reads G5000_ROUTER_ROOT at import time to locate its cache dir,
// so point it at a throwaway temp dir BEFORE importing.
let mod: typeof import('./ecmwf-global-cache.js');
let root: string;

beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), 'g5000-gc-test-'));
  process.env.G5000_ROUTER_ROOT = root;
  mod = await import('./ecmwf-global-cache.js');
});

afterAll(async () => {
  await rm(root, { recursive: true, force: true });
});

function makeGlobalGrid(runAt: number, fh: number): WindGrid {
  const lats = [10, 11, 12, 13, 14];
  const lons = [-70, -69, -68, -67, -66, -65];
  const u = lats.map((_, y) => lons.map((_l, x) => y * 10 + x));
  const v = lats.map((_, y) => lons.map((_l, x) => -(y * 10 + x)));
  const prmsl = lats.map((_, y) => lons.map((_l, x) => 100000 + y * 100 + x));
  return {
    lats,
    lons,
    u,
    v,
    prmsl,
    validAt: runAt + fh * 3600,
    runAt,
    forecastHour: fh,
    model: 'ecmwf',
  };
}

describe('ecmwf-global-cache', () => {
  const runAt = 1_700_000_000;
  const fh = 6;

  it('round-trips a global grid and crops only the ROI', async () => {
    await mod.writeGlobalGrid(makeGlobalGrid(runAt, fh));
    const cropped = await mod.cropFromGlobalCache(runAt, fh, {
      latMin: 11,
      latMax: 13,
      lonMin: -69,
      lonMax: -67,
    });
    expect(cropped).not.toBeNull();
    expect(cropped!.lats).toEqual([11, 12, 13]); // Float64 coords stay exact
    expect(cropped!.lons).toEqual([-69, -68, -67]);
    expect(cropped!.runAt).toBe(runAt);
    expect(cropped!.forecastHour).toBe(fh);
    expect(cropped!.validAt).toBe(runAt + fh * 3600);
    expect(cropped!.model).toBe('ecmwf');
    // grid[0][0] = global lat idx 1, lon idx 1 → u = 1*10 + 1 = 11
    expect(cropped!.u[0]![0]).toBeCloseTo(11, 5);
    expect(cropped!.v[0]![0]).toBeCloseTo(-11, 5);
    expect(cropped!.prmsl![0]![0]).toBeCloseTo(100101, 1);
    // bottom-right of ROI: lat idx 3, lon idx 3 → u = 3*10 + 3 = 33
    expect(cropped!.u[2]![2]).toBeCloseTo(33, 5);
    // asymmetric off-diagonal points lock down [lat][lon] orientation
    // (a transposed read would swap these): u[0][2] = lat1,lon3 = 13;
    // u[2][0] = lat3,lon1 = 31.
    expect(cropped!.u[0]![2]).toBeCloseTo(13, 5);
    expect(cropped!.u[2]![0]).toBeCloseTo(31, 5);
  });

  it('returns null when the bbox is outside the grid', async () => {
    const out = await mod.cropFromGlobalCache(runAt, fh, {
      latMin: 80,
      latMax: 85,
      lonMin: 10,
      lonMax: 20,
    });
    expect(out).toBeNull();
  });

  it('returns null on a cache miss', async () => {
    const miss = await mod.cropFromGlobalCache(runAt, 999, {
      latMin: 11,
      latMax: 13,
      lonMin: -69,
      lonMax: -67,
    });
    expect(miss).toBeNull();
  });

  it('prunes stale runs by filename but keeps fresh ones', async () => {
    const now = Date.now();
    const freshRunAt = Math.floor(now / 1000); // valid ~now
    const staleRunAt = 1_000_000_000; // 2001 — long past
    await mod.writeGlobalGrid(makeGlobalGrid(freshRunAt, 0));
    await mod.writeGlobalGrid(makeGlobalGrid(staleRunAt, 0));
    const pruned = await mod.pruneGlobalCache(now);
    expect(pruned).toBeGreaterThanOrEqual(1);
    // fresh survives, stale gone
    expect(
      await mod.cropFromGlobalCache(freshRunAt, 0, {
        latMin: 11,
        latMax: 13,
        lonMin: -69,
        lonMax: -67,
      }),
    ).not.toBeNull();
    expect(
      await mod.cropFromGlobalCache(staleRunAt, 0, {
        latMin: 11,
        latMax: 13,
        lonMin: -69,
        lonMax: -67,
      }),
    ).toBeNull();
  });

  it('prunes superseded runs even when their valid time is still in the future', async () => {
    const now = Date.now();
    const nowSec = Math.floor(now / 1000);
    const oldRun = nowSec - 6 * 3600; // previous 6 h run
    const newRun = nowSec; // current run
    // Far-future hour of the OLD run: validAt is well ahead of now, so the
    // time rule alone would keep it — but it's superseded and never read again.
    await mod.writeGlobalGrid(makeGlobalGrid(oldRun, 120));
    await mod.writeGlobalGrid(makeGlobalGrid(newRun, 120));
    const bbox = { latMin: 11, latMax: 13, lonMin: -69, lonMax: -67 };
    await mod.pruneGlobalCache(now, undefined, newRun);
    expect(await mod.cropFromGlobalCache(oldRun, 120, bbox)).toBeNull();
    expect(await mod.cropFromGlobalCache(newRun, 120, bbox)).not.toBeNull();
  });
});
