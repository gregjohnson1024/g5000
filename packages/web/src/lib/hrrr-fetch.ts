import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  spawnText,
  parseGridData,
  type Bbox,
  type WindGrid,
} from './wind-fetch';

const NOMADS = 'https://nomads.ncep.noaa.gov/cgi-bin/filter_hrrr_2d.pl';

export interface BuildHrrrUrlOpts {
  runDateUtc: string; // YYYY-MM-DD
  runHourUtc: number; // 0..23
  forecastHour: number; // 0..18 (or ..48 on synoptic runs)
  bbox: Bbox;
}

export function buildHrrrUrl(o: BuildHrrrUrlOpts): string {
  const dateNoDash = o.runDateUtc.replace(/-/g, '');
  const hh = String(o.runHourUtc).padStart(2, '0');
  const ff = String(o.forecastHour).padStart(2, '0');
  const p = new URLSearchParams();
  p.set('dir', `/hrrr.${dateNoDash}/conus`);
  p.set('file', `hrrr.t${hh}z.wrfsfcf${ff}.grib2`);
  p.set('var_UGRD', 'on');
  p.set('var_VGRD', 'on');
  p.set('lev_10_m_above_ground', 'on');
  p.set('subregion', '');
  p.set('toplat', String(o.bbox.latMax));
  p.set('leftlon', String(o.bbox.lonMin));
  p.set('rightlon', String(o.bbox.lonMax));
  p.set('bottomlat', String(o.bbox.latMin));
  return `${NOMADS}?${p.toString()}`;
}

/** HRRR runs hourly, posts ~50–90 min after the hour; lag 2 h for safety. */
export function pickHrrrRun(atUnixSec: number): { runDateUtc: string; runHourUtc: number } {
  const d = new Date(atUnixSec * 1000 - 2 * 3600 * 1000);
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return { runDateUtc: `${y}-${m}-${day}`, runHourUtc: d.getUTCHours() };
}

/** f00–f18 on most runs; f00–f48 on the synoptic 00/06/12/18z runs. */
export function hrrrHorizonHours(runHourUtc: number): number {
  return runHourUtc % 6 === 0 ? 48 : 18;
}

/** Rough CONUS+coastal envelope. Outside this, HRRR has no data. The eastern
 *  edge is clamped to -66° (the coast of Maine) rather than -60°: HRRR's CONUS
 *  grid stops well west of Bermuda (~-64.7°), so a -60° bound would wrongly
 *  admit mid-Atlantic boxes that the model never covers. */
export function inHrrrDomain(b: Bbox): boolean {
  return b.latMin >= 21 && b.latMax <= 53 && b.lonMin >= -135 && b.lonMax <= -66;
}

/** Target lat/lon resolution of the regridded HRRR field, in degrees. ~3 km
 *  at mid-latitudes, preserving HRRR's native detail. */
const REGRID_DEG = 0.03;

/**
 * Download an HRRR 10 m-wind subset for `bbox` at `forecastHour` of the most
 * recent run, regrid from its native Lambert Conformal Conic projection to a
 * regular lat/lon grid with **earth-relative** winds, decode via eccodes, and
 * return a normalised `WindGrid` (`model: 'hrrr'`).
 *
 * The Lambert→latlon regrid is the crux: HRRR stores winds grid-relative, so
 * `-new_grid_winds earth` is REQUIRED — without it every wind vector is rotated
 * by the local grid-convergence angle and the displayed directions are wrong.
 *
 * Requires `wgrib2` plus `grib_copy`/`grib_get_data` (eccodes) on PATH. Mirrors
 * `fetchWindGrid` (GFS) for temp-dir handling, parse, and the returned grid
 * shape; the regrid stage is inserted between download and parse.
 */
export async function fetchHrrrGrid(
  bbox: Bbox,
  forecastHour: number,
  now: Date = new Date(),
  signal?: AbortSignal,
): Promise<WindGrid> {
  if (!inHrrrDomain(bbox)) {
    throw new Error(
      `HRRR covers US waters only; bbox ` +
        `[${bbox.latMin.toFixed(1)}..${bbox.latMax.toFixed(1)}, ` +
        `${bbox.lonMin.toFixed(1)}..${bbox.lonMax.toFixed(1)}] is outside the HRRR domain`,
    );
  }
  const run = pickHrrrRun(now.getTime() / 1000);
  const horizon = hrrrHorizonHours(run.runHourUtc);
  if (forecastHour > horizon) {
    throw new Error(
      `forecast hour +${forecastHour}h is beyond the HRRR horizon (+${horizon}h for the ${String(
        run.runHourUtc,
      ).padStart(2, '0')}z run)`,
    );
  }
  const runUnix =
    Date.UTC(
      Number(run.runDateUtc.slice(0, 4)),
      Number(run.runDateUtc.slice(5, 7)) - 1,
      Number(run.runDateUtc.slice(8, 10)),
      run.runHourUtc,
    ) / 1000;

  const url = buildHrrrUrl({
    runDateUtc: run.runDateUtc,
    runHourUtc: run.runHourUtc,
    forecastHour,
    bbox,
  });
  // 60-s timeout — NOMADS does its own server-side bbox subsetting, so the
  // response can take a beat to assemble. Combine with any external cancel
  // signal so a superseded refresh aborts the download immediately.
  const fetchSig = signal
    ? AbortSignal.any([AbortSignal.timeout(60_000), signal])
    : AbortSignal.timeout(60_000);
  const resp = await fetch(url, { signal: fetchSig });
  if (!resp.ok) {
    throw new Error(`NOMADS HRRR fetch failed: HTTP ${resp.status} ${resp.statusText}`);
  }
  const buf = Buffer.from(await resp.arrayBuffer());
  if (buf.length < 100) throw new Error(`NOMADS returned tiny payload (${buf.length} bytes)`);

  const dir = await mkdtemp(join(tmpdir(), 'g5000-hrrr-'));
  try {
    const inPath = join(dir, 'in.grib2');
    const regridPath = join(dir, 'regrid.grib2');
    await writeFile(inPath, buf);

    // Lambert Conformal → regular lat/lon. `-new_grid_winds earth` makes U/V
    // earth-relative (HRRR stores them grid-relative). nx/ny from the bbox span
    // at ~3 km (REGRID_DEG). lon0/lat0 are the SW corner.
    const lon0 = bbox.lonMin;
    const lat0 = bbox.latMin;
    const nx = Math.max(2, Math.ceil((bbox.lonMax - bbox.lonMin) / REGRID_DEG));
    const ny = Math.max(2, Math.ceil((bbox.latMax - bbox.latMin) / REGRID_DEG));
    await spawnText('wgrib2', [
      inPath,
      '-new_grid_winds',
      'earth',
      '-new_grid',
      'latlon',
      `${lon0}:${nx}:${REGRID_DEG}`,
      `${lat0}:${ny}:${REGRID_DEG}`,
      regridPath,
    ]);

    const uOnly = join(dir, 'u.grib2');
    const vOnly = join(dir, 'v.grib2');
    await spawnText('grib_copy', ['-w', 'shortName=10u', regridPath, uOnly]);
    await spawnText('grib_copy', ['-w', 'shortName=10v', regridPath, vOnly]);
    const uTxt = await spawnText('grib_get_data', [uOnly]);
    const vTxt = await spawnText('grib_get_data', [vOnly]);
    const uRecs = parseGridData(uTxt);
    const vRecs = parseGridData(vTxt);
    if (uRecs.length === 0 || vRecs.length === 0) {
      throw new Error('HRRR regrid produced no grid points');
    }
    const latsSet = new Set<number>();
    const lonsSet = new Set<number>();
    for (const r of uRecs) {
      latsSet.add(r.lat);
      lonsSet.add(r.lon);
    }
    const lats = [...latsSet].sort((a, b) => a - b);
    const lons = [...lonsSet].sort((a, b) => a - b);
    const u: number[][] = lats.map(() => lons.map(() => NaN));
    const v: number[][] = lats.map(() => lons.map(() => NaN));
    const latIx = new Map(lats.map((l, i) => [l, i]));
    const lonIx = new Map(lons.map((l, i) => [l, i]));
    for (const r of uRecs) {
      const yi = latIx.get(r.lat);
      const xi = lonIx.get(r.lon);
      if (yi !== undefined && xi !== undefined) u[yi]![xi] = r.v;
    }
    for (const r of vRecs) {
      const yi = latIx.get(r.lat);
      const xi = lonIx.get(r.lon);
      if (yi !== undefined && xi !== undefined) v[yi]![xi] = r.v;
    }
    const validAt = runUnix + forecastHour * 3600;
    // HRRR's filter does not carry PRMSL in this subset; omit isobars.
    return { lats, lons, u, v, validAt, runAt: runUnix, forecastHour, model: 'hrrr' };
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
