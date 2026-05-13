import { spawn } from 'node:child_process';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fetchEcmwfMessages, pickEcmwfRun } from '@g5000/grib';

export type WindModel = 'gfs' | 'ecmwf';

const NOMADS = 'https://nomads.ncep.noaa.gov/cgi-bin/filter_gfs_0p25.pl';

export interface WindGrid {
  /** Sorted ascending; len = u/v rows. */
  lats: number[];
  /** Sorted ascending; len = u/v cols. */
  lons: number[];
  /** Eastward component, m/s. Indexed [latIdx][lonIdx]. */
  u: number[][];
  /** Northward component, m/s. Indexed [latIdx][lonIdx]. */
  v: number[][];
  /** UTC seconds for the valid time of this forecast. */
  validAt: number;
  /** UTC seconds for the model run time. */
  runAt: number;
  /** Hours after run that this forecast is valid (0, 3, 6, …). */
  forecastHour: number;
  /** Which model produced this grid. */
  model: WindModel;
}

export interface Bbox {
  latMin: number;
  latMax: number;
  lonMin: number;
  lonMax: number;
}

/**
 * Pick the most recently completed GFS 0p25 run for `forecastHour` ahead of
 * `at`. GFS runs at 00/06/12/18 UTC and the run becomes available ~3.5 h
 * after its nominal time.
 */
export function pickRun(at: Date, leadSafetyHours = 4): { runDateUtc: string; runHourUtc: 0 | 6 | 12 | 18; runUnix: number } {
  // Subtract the publication-lag safety so we don't try to fetch a run that
  // hasn't been published yet.
  const t = new Date(at.getTime() - leadSafetyHours * 3600 * 1000);
  const h = t.getUTCHours();
  let hh: 0 | 6 | 12 | 18;
  if (h >= 18) hh = 18;
  else if (h >= 12) hh = 12;
  else if (h >= 6) hh = 6;
  else hh = 0;
  const yyyy = t.getUTCFullYear();
  const mm = String(t.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(t.getUTCDate()).padStart(2, '0');
  const runDateUtc = `${yyyy}-${mm}-${dd}`;
  const runUnix = Date.UTC(yyyy, t.getUTCMonth(), t.getUTCDate(), hh) / 1000;
  return { runDateUtc, runHourUtc: hh, runUnix };
}

export function buildGfsUrl(o: {
  runDateUtc: string;
  runHourUtc: 0 | 6 | 12 | 18;
  forecastHour: number;
  bbox: Bbox;
}): string {
  const dateNoDash = o.runDateUtc.replace(/-/g, '');
  const hh = String(o.runHourUtc).padStart(2, '0');
  const fff = String(o.forecastHour).padStart(3, '0');
  const params = new URLSearchParams();
  params.set('dir', `/gfs.${dateNoDash}/${hh}/atmos`);
  params.set('file', `gfs.t${hh}z.pgrb2.0p25.f${fff}`);
  params.set('var_UGRD', 'on');
  params.set('var_VGRD', 'on');
  params.set('lev_10_m_above_ground', 'on');
  params.set('subregion', '');
  params.set('toplat', String(o.bbox.latMax));
  params.set('leftlon', String(o.bbox.lonMin));
  params.set('rightlon', String(o.bbox.lonMax));
  params.set('bottomlat', String(o.bbox.latMin));
  return `${NOMADS}?${params.toString()}`;
}

function spawnText(cmd: string, args: string[]): Promise<string> {
  return new Promise((resolveP, rejectP) => {
    const p = spawn(cmd, args);
    let out = '';
    let err = '';
    p.stdout.on('data', (d) => (out += d.toString()));
    p.stderr.on('data', (d) => (err += d.toString()));
    p.on('error', rejectP);
    p.on('close', (code) => {
      if (code === 0) resolveP(out);
      else rejectP(new Error(`${cmd} ${args.slice(0, 3).join(' ')}…: exit ${code}: ${err.slice(0, 200)}`));
    });
  });
}

/**
 * Parse `grib_get_data` text output. Format (after header line):
 *   Latitude, Longitude, Value
 *       33.000     -65.000      5.42
 * Returns one record per grid point.
 */
function parseGridData(text: string): Array<{ lat: number; lon: number; v: number }> {
  const out: Array<{ lat: number; lon: number; v: number }> = [];
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    if (trimmed.startsWith('Latitude')) continue;
    const parts = trimmed.split(/\s+/);
    if (parts.length < 3) continue;
    const lat = Number(parts[0]);
    const lonRaw = Number(parts[1]);
    const v = Number(parts[2]);
    if (!Number.isFinite(lat) || !Number.isFinite(lonRaw) || !Number.isFinite(v)) continue;
    const lon = lonRaw > 180 ? lonRaw - 360 : lonRaw;
    out.push({ lat, lon, v });
  }
  return out;
}

/**
 * Download a GFS 10m-wind subset for `bbox` at `forecastHour` of the most
 * recent run, decode via eccodes, and return a normalised grid.
 *
 * Requires `grib_get_data` and `grib_copy` from eccodes on PATH.
 */
export async function fetchWindGrid(
  bbox: Bbox,
  forecastHour: number,
  now: Date = new Date(),
): Promise<WindGrid> {
  const run = pickRun(now);
  const url = buildGfsUrl({
    runDateUtc: run.runDateUtc,
    runHourUtc: run.runHourUtc,
    forecastHour,
    bbox,
  });
  const resp = await fetch(url);
  if (!resp.ok) {
    throw new Error(`NOMADS GFS fetch failed: HTTP ${resp.status} ${resp.statusText}`);
  }
  const buf = Buffer.from(await resp.arrayBuffer());
  if (buf.length < 100) throw new Error(`NOMADS returned tiny payload (${buf.length} bytes)`);

  const dir = await mkdtemp(join(tmpdir(), 'g5000-grib-'));
  try {
    const gribPath = join(dir, 'in.grib2');
    await writeFile(gribPath, buf);
    const uOnly = join(dir, 'u.grib2');
    const vOnly = join(dir, 'v.grib2');
    await spawnText('grib_copy', ['-w', 'shortName=10u', gribPath, uOnly]);
    await spawnText('grib_copy', ['-w', 'shortName=10v', gribPath, vOnly]);
    const uTxt = await spawnText('grib_get_data', [uOnly]);
    const vTxt = await spawnText('grib_get_data', [vOnly]);
    const uRecs = parseGridData(uTxt);
    const vRecs = parseGridData(vTxt);
    if (uRecs.length === 0 || vRecs.length === 0) {
      throw new Error('eccodes returned no grid points');
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
    const validAt = run.runUnix + forecastHour * 3600;
    return { lats, lons, u, v, validAt, runAt: run.runUnix, forecastHour, model: 'gfs' };
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

/**
 * Decode a (possibly multi-message) GRIB2 buffer into U + V grids by
 * splitting and running grib_get_data on each. The buffer should contain
 * either one or both of {10u, 10v} as separate messages; messages are
 * paired by shortName, not order, so the ordering of input messages
 * doesn't matter.
 */
async function decodeUVGrib(rawGrib: Buffer, model: WindModel, runAt: number, fh: number): Promise<WindGrid> {
  const dir = await mkdtemp(join(tmpdir(), 'g5000-grib-'));
  try {
    const gribPath = join(dir, 'in.grib2');
    await writeFile(gribPath, rawGrib);
    const uOnly = join(dir, 'u.grib2');
    const vOnly = join(dir, 'v.grib2');
    await spawnText('grib_copy', ['-w', 'shortName=10u', gribPath, uOnly]);
    await spawnText('grib_copy', ['-w', 'shortName=10v', gribPath, vOnly]);
    const uTxt = await spawnText('grib_get_data', [uOnly]);
    const vTxt = await spawnText('grib_get_data', [vOnly]);
    const uRecs = parseGridData(uTxt);
    const vRecs = parseGridData(vTxt);
    if (uRecs.length === 0 || vRecs.length === 0) throw new Error('eccodes returned no grid points');
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
    return { lats, lons, u, v, validAt: runAt + fh * 3600, runAt, forecastHour: fh, model };
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

/**
 * Crop a `WindGrid` to an inclusive bbox. ECMWF Open Data is global only
 * so we fetch globally and crop locally.
 */
function cropGrid(grid: WindGrid, bbox: Bbox): WindGrid {
  const latKeep: number[] = [];
  const latIdx: number[] = [];
  for (let i = 0; i < grid.lats.length; i++) {
    const lat = grid.lats[i]!;
    if (lat >= bbox.latMin && lat <= bbox.latMax) {
      latKeep.push(lat);
      latIdx.push(i);
    }
  }
  const lonKeep: number[] = [];
  const lonIdx: number[] = [];
  for (let i = 0; i < grid.lons.length; i++) {
    const lon = grid.lons[i]!;
    if (lon >= bbox.lonMin && lon <= bbox.lonMax) {
      lonKeep.push(lon);
      lonIdx.push(i);
    }
  }
  const u: number[][] = latIdx.map((yi) => lonIdx.map((xi) => grid.u[yi]![xi]!));
  const v: number[][] = latIdx.map((yi) => lonIdx.map((xi) => grid.v[yi]![xi]!));
  return { ...grid, lats: latKeep, lons: lonKeep, u, v };
}

/**
 * Fetch ECMWF IFS Open Data 0p25 wind at the given forecast hour, decode,
 * and crop to bbox. ECMWF Open Data IFS publishes only every 6 hours
 * (0/6/12/18 z) with forecast hours at 0/3/6/.../240; this function rounds
 * the request to the nearest 3 h step.
 */
export async function fetchWindGridEcmwf(
  bbox: Bbox,
  forecastHour: number,
  now: Date = new Date(),
): Promise<WindGrid> {
  const run = pickEcmwfRun(now.getTime() / 1000);
  const runUnix = Date.UTC(
    Number(run.runDateUtc.slice(0, 4)),
    Number(run.runDateUtc.slice(5, 7)) - 1,
    Number(run.runDateUtc.slice(8, 10)),
    run.runHourUtc,
  ) / 1000;
  // Round to nearest 3 h step (Open Data IFS step cadence).
  const fh = Math.max(0, Math.round(forecastHour / 3) * 3);
  const messages = await fetchEcmwfMessages({
    runDateUtc: run.runDateUtc,
    runHourUtc: run.runHourUtc,
    forecastHour: fh,
    variables: ['10u', '10v'],
  });
  if (messages.length === 0) {
    throw new Error('ECMWF: no GRIB messages returned (run may not be posted yet)');
  }
  const combined = Buffer.concat(messages);
  const globalGrid = await decodeUVGrib(combined, 'ecmwf', runUnix, fh);
  return cropGrid(globalGrid, bbox);
}
