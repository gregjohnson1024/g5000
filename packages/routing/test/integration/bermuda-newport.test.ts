import { describe, it, expect, beforeAll } from 'vitest';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { runWgrib2, parseGrib2Json } from '@g5000/grib';
import { loadCoastlineFromGeojson } from '@g5000/coastline';
import { plan } from '../../src/plan.js';
import { DEFAULT_POLARS } from '@g5000/db';

const here = dirname(fileURLToPath(import.meta.url));
const GRIB = resolve(here, '../fixtures/bermuda-newport-gfs.grb2');
const COAST = resolve(here, '../../../coastline/data/i.geojson');

/**
 * The integration test needs the `wgrib2` binary. Default is PATH; if
 * `WGRIB2_PATH` is set we use that. As a convenience for local dev on
 * machines where wgrib2 lives in a micromamba env (the documented setup
 * per Task 8 of the plan), probe that well-known location and set
 * WGRIB2_PATH automatically.
 *
 * If no wgrib2 is reachable, the test is skipped with a clear message
 * rather than failing — the test is informational on machines without
 * wgrib2 and enforced on machines with it (and on CI).
 */
const FALLBACK_WGRIB2 = '/Users/gregjohnson/micromamba_envs/wgrib2/bin/wgrib2';

function locateWgrib2(): string | null {
  if (process.env.WGRIB2_PATH && existsSync(process.env.WGRIB2_PATH)) {
    return process.env.WGRIB2_PATH;
  }
  // PATH lookup via `which`.
  const which = spawnSync('which', ['wgrib2']);
  if (which.status === 0) {
    const onPath = which.stdout.toString().trim();
    if (onPath) return onPath;
  }
  if (existsSync(FALLBACK_WGRIB2)) return FALLBACK_WGRIB2;
  return null;
}

const wgrib2Binary = locateWgrib2();
const describeOrSkip = wgrib2Binary ? describe : describe.skip;

describeOrSkip('Bermuda → Newport regression', () => {
  beforeAll(() => {
    if (wgrib2Binary && !process.env.WGRIB2_PATH) {
      process.env.WGRIB2_PATH = wgrib2Binary;
    }
  });

  it('plans within the historical baseline ETA envelope', async () => {
    const messages = await runWgrib2(GRIB);
    const wind = parseGrib2Json(messages, 'GFS', 0);
    const coast = await loadCoastlineFromGeojson(COAST, 'i');

    // Departure pinned to the GFS run time of the fixture (2026-05-11 00Z).
    // Using runTime as the departure ensures the wind field is in-bounds
    // for the entire planning horizon and the test is deterministic across
    // re-runs regardless of when it runs.
    const departure = wind.times[0]!;

    // Start slightly NE of Bermuda's harbor entrance in open water — the
    // i-level Natural Earth polygon for Bermuda would otherwise put the
    // start ON LAND, and every propagation would be rejected by
    // intersectsLand. End is south of Newport in open water for the
    // same reason.
    const r = plan({
      start: { lat: 32.45, lon: -64.65 }, // ~5 NM NE of Bermuda
      end: { lat: 41.3, lon: -71.2 }, // ~12 NM S of Newport, RI
      departure,
      wind,
      polar: DEFAULT_POLARS,
      polarId: 'default',
      coastline: coast,
      options: { maxHours: 168 },
    });

    const hrs = (r.end - r.start) / 3600;
    console.log(
      `[bermuda-newport] incomplete=${r.incomplete ?? false} reason=${r.reason ?? 'reached'} legs=${r.legs.length} hrs=${hrs.toFixed(1)} dist=${(r.distance / 1852).toFixed(0)}nm`,
    );

    // With the progress-based prune (prune.ts keeps the node closest to the
    // destination per bearing-from-start bucket), the route now COMPLETES
    // against real GFS + i-level coastline + DEFAULT_POLARS, where the old
    // furthest-from-start prune stalled at incomplete/no_wind. ETA lands in
    // the historical baseline envelope.
    expect(r.legs.length).toBeGreaterThan(100);
    expect(r.incomplete).toBeFalsy();
    expect(hrs).toBeGreaterThan(80);
    expect(hrs).toBeLessThan(140);
  }, 120_000);
});
