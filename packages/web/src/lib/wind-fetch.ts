import { spawn } from 'node:child_process';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pickEcmwfRun } from '@g5000/grib';
import { cropFromGlobalCache, writeGlobalGrid } from './ecmwf-global-cache';
import { pickRun } from './wind-runs';

// Re-export the cache, run-selection, and key helpers that previously lived in
// this file so every existing consumer (api/wind, api/forecast/*, grib-context,
// hrrr-fetch, …) keeps importing them from '../lib/wind-fetch' unchanged.
export { windCache, bboxKey, windFieldFromCache, selectConsistentGrids } from './wind-cache';
export { pickRun, runAvailability, expectedRunUnix, PUBLICATION_LAG_HOURS } from './wind-runs';

// ECMWF Open Data IFS is mirrored on AWS S3 (public bucket, no auth, no rate
// limit). Prefer it over data.ecmwf.int which 429s aggressively after a
// handful of requests.
const ECMWF_S3 = 'https://ecmwf-forecasts.s3.eu-central-1.amazonaws.com';

interface EcmwfIndexLine {
  param: string;
  _offset: number;
  _length: number;
}

/** Combine the per-fetch hard timeout with an optional external cancel signal,
 *  so a superseded refresh aborts its in-flight downloads immediately. */
function fetchSignal(timeoutMs: number, cancel?: AbortSignal): AbortSignal {
  const timeout = AbortSignal.timeout(timeoutMs);
  return cancel ? AbortSignal.any([timeout, cancel]) : timeout;
}

async function fetchEcmwfMessagesS3(opts: {
  runDateUtc: string;
  runHourUtc: 0 | 6 | 12 | 18;
  forecastHour: number;
  variables: Array<'10u' | '10v' | 'msl'>;
  signal?: AbortSignal;
}): Promise<Buffer[]> {
  const date = opts.runDateUtc.replace(/-/g, '');
  const hh = String(opts.runHourUtc).padStart(2, '0');
  const base = `${ECMWF_S3}/${date}/${hh}z/ifs/0p25/oper`;
  const stem = `${date}${hh}0000-${opts.forecastHour}h-oper-fc`;
  const idxUrl = `${base}/${stem}.index`;
  const gribUrl = `${base}/${stem}.grib2`;
  // Hard 30-s timeout on every outbound fetch — a slow ECMWF S3 connection
  // without this will hang the autopilot's event loop indefinitely (the
  // refresh endpoint loops 50+ times per model, so one hung fetch stalls
  // every subsequent request).
  const idxRes = await fetch(idxUrl, { signal: fetchSignal(30_000, opts.signal) });
  if (!idxRes.ok) {
    throw new Error(`ECMWF S3 index ${idxUrl} → ${idxRes.status}`);
  }
  const text = await idxRes.text();
  const lines = text
    .split(/\n/)
    .filter(Boolean)
    .map((l) => JSON.parse(l) as EcmwfIndexLine);
  const wanted = lines.filter((l) => opts.variables.includes(l.param as '10u' | '10v' | 'msl'));
  // Fetch the per-variable byte ranges concurrently. The S3 bucket is in
  // eu-central-1, so from the western Atlantic each request pays a fat
  // round-trip; running them back-to-back made the download dominate the
  // whole ECMWF fetch (~7 s of a ~9 s total). They're independent reads of
  // the same object, decodeUVGrib pairs messages by shortName not order, so
  // overlapping the round-trips is safe and collapses download wall-time to
  // roughly the slowest single range.
  return Promise.all(
    wanted.map(async (w) => {
      const res = await fetch(gribUrl, {
        headers: { Range: `bytes=${w._offset}-${w._offset + w._length - 1}` },
        signal: fetchSignal(30_000, opts.signal),
      });
      if (!(res.status === 200 || res.status === 206)) {
        throw new Error(`ECMWF S3 range fetch failed: ${res.status} for param=${w.param}`);
      }
      return Buffer.from(await res.arrayBuffer());
    }),
  );
}

export type WindModel = 'gfs' | 'ecmwf' | 'hrrr';

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
  /** Mean sea-level pressure, Pa. Indexed [latIdx][lonIdx]. Null if unavailable. */
  prmsl?: number[][];
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
  params.set('var_PRMSL', 'on');
  params.set('lev_10_m_above_ground', 'on');
  params.set('lev_mean_sea_level', 'on');
  params.set('subregion', '');
  params.set('toplat', String(o.bbox.latMax));
  params.set('leftlon', String(o.bbox.lonMin));
  params.set('rightlon', String(o.bbox.lonMax));
  params.set('bottomlat', String(o.bbox.latMin));
  return `${NOMADS}?${params.toString()}`;
}

export function spawnText(cmd: string, args: string[]): Promise<string> {
  return new Promise((resolveP, rejectP) => {
    const p = spawn(cmd, args);
    let out = '';
    let err = '';
    p.stdout.on('data', (d) => (out += d.toString()));
    p.stderr.on('data', (d) => (err += d.toString()));
    p.on('error', rejectP);
    p.on('close', (code) => {
      if (code === 0) resolveP(out);
      else
        rejectP(
          new Error(`${cmd} ${args.slice(0, 3).join(' ')}…: exit ${code}: ${err.slice(0, 200)}`),
        );
    });
  });
}

/**
 * Parse `grib_get_data` text output. Format (after header line):
 *   Latitude, Longitude, Value
 *       33.000     -65.000      5.42
 * Returns one record per grid point.
 */
export function parseGridData(text: string): Array<{ lat: number; lon: number; v: number }> {
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

type GribRecord = { lat: number; lon: number; v: number };

/**
 * Assemble parsed U/V/PRMSL records into a normalised `WindGrid`. Builds the
 * sorted lat/lon axes from the U records, allocates the 2-D arrays (NaN-filled),
 * and scatters each record into its [latIdx][lonIdx] cell via the index maps.
 * PRMSL is omitted entirely when no pressure records are supplied. `validAt`
 * is recomputed from `runAt + forecastHour * 3600`. Throws if U or V is empty.
 */
function recordsToGrid(
  uRecs: GribRecord[],
  vRecs: GribRecord[],
  pRecs: GribRecord[],
  meta: { runAt: number; forecastHour: number; model: WindModel },
): WindGrid {
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
  const prmsl: number[][] | undefined =
    pRecs.length > 0 ? lats.map(() => lons.map(() => NaN)) : undefined;
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
  if (prmsl) {
    for (const r of pRecs) {
      const yi = latIx.get(r.lat);
      const xi = lonIx.get(r.lon);
      if (yi !== undefined && xi !== undefined) prmsl[yi]![xi] = r.v;
    }
  }
  return {
    lats,
    lons,
    u,
    v,
    prmsl,
    validAt: meta.runAt + meta.forecastHour * 3600,
    runAt: meta.runAt,
    forecastHour: meta.forecastHour,
    model: meta.model,
  };
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
  signal?: AbortSignal,
): Promise<WindGrid> {
  const run = pickRun(now);
  const url = buildGfsUrl({
    runDateUtc: run.runDateUtc,
    runHourUtc: run.runHourUtc,
    forecastHour,
    bbox,
  });
  // 60-s timeout for GFS NOMADS — it does its own server-side bbox subsetting
  // so the response can take a beat to assemble for larger ROIs.
  const resp = await fetch(url, { signal: fetchSignal(60_000, signal) });
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
    const pOnly = join(dir, 'p.grib2');
    await spawnText('grib_copy', ['-w', 'shortName=10u', gribPath, uOnly]);
    await spawnText('grib_copy', ['-w', 'shortName=10v', gribPath, vOnly]);
    // PRMSL is optional — older NOMADS files may not have it. Don't fail
    // wind decoding if pressure extraction fails.
    let pTxt: string | null = null;
    try {
      await spawnText('grib_copy', ['-w', 'shortName=prmsl', gribPath, pOnly]);
      pTxt = await spawnText('grib_get_data', [pOnly]);
    } catch {
      pTxt = null;
    }
    const uTxt = await spawnText('grib_get_data', [uOnly]);
    const vTxt = await spawnText('grib_get_data', [vOnly]);
    const uRecs = parseGridData(uTxt);
    const vRecs = parseGridData(vTxt);
    const pRecs = pTxt ? parseGridData(pTxt) : [];
    return recordsToGrid(uRecs, vRecs, pRecs, {
      runAt: run.runUnix,
      forecastHour,
      model: 'gfs',
    });
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
async function decodeUVGrib(
  rawGrib: Buffer,
  model: WindModel,
  runAt: number,
  fh: number,
): Promise<WindGrid> {
  const dir = await mkdtemp(join(tmpdir(), 'g5000-grib-'));
  try {
    const gribPath = join(dir, 'in.grib2');
    await writeFile(gribPath, rawGrib);
    const uOnly = join(dir, 'u.grib2');
    const vOnly = join(dir, 'v.grib2');
    const pOnly = join(dir, 'p.grib2');
    await spawnText('grib_copy', ['-w', 'shortName=10u', gribPath, uOnly]);
    await spawnText('grib_copy', ['-w', 'shortName=10v', gribPath, vOnly]);
    let pTxt: string | null = null;
    try {
      await spawnText('grib_copy', ['-w', 'shortName=msl', gribPath, pOnly]);
      pTxt = await spawnText('grib_get_data', [pOnly]);
    } catch {
      pTxt = null;
    }
    const uTxt = await spawnText('grib_get_data', [uOnly]);
    const vTxt = await spawnText('grib_get_data', [vOnly]);
    const uRecs = parseGridData(uTxt);
    const vRecs = parseGridData(vTxt);
    const pRecs = pTxt ? parseGridData(pTxt) : [];
    return recordsToGrid(uRecs, vRecs, pRecs, { runAt, forecastHour: fh, model });
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
  const prmsl: number[][] | undefined = grid.prmsl
    ? latIdx.map((yi) => lonIdx.map((xi) => grid.prmsl![yi]![xi]!))
    : undefined;
  return { ...grid, lats: latKeep, lons: lonKeep, u, v, prmsl };
}

/**
 * Fetch ECMWF IFS Open Data 0p25 wind at the given forecast hour, decode,
 * and crop to bbox. ECMWF Open Data IFS publishes only every 6 hours
 * (0/6/12/18 z) with forecast hours at 0/3/6/.../240; this function rounds
 * the request to the nearest 3 h step.
 *
 * Messages come from the public ECMWF S3 mirror (no auth, no rate limiting)
 * via concurrent per-variable byte-range reads, each with a 30 s timeout. There
 * is no 429 retry here — the S3 mirror is used precisely to avoid the
 * data.ecmwf.int CDN's aggressive rate limiting.
 */
export async function fetchWindGridEcmwf(
  bbox: Bbox,
  forecastHour: number,
  now: Date = new Date(),
  signal?: AbortSignal,
): Promise<WindGrid> {
  const run = pickEcmwfRun(now.getTime() / 1000);
  const runUnix =
    Date.UTC(
      Number(run.runDateUtc.slice(0, 4)),
      Number(run.runDateUtc.slice(5, 7)) - 1,
      Number(run.runDateUtc.slice(8, 10)),
      run.runHourUtc,
    ) / 1000;
  const fh = Math.max(0, Math.round(forecastHour / 3) * 3);

  // The global field for this (run, fh) is identical regardless of bbox, so a
  // box change just re-crops the cached globe instead of re-downloading it.
  const hit = await cropFromGlobalCache(runUnix, fh, bbox);
  if (hit) return hit;

  const messages = await fetchEcmwfMessagesS3({
    runDateUtc: run.runDateUtc,
    runHourUtc: run.runHourUtc,
    forecastHour: fh,
    variables: ['10u', '10v', 'msl'],
    signal,
  });
  if (messages.length === 0) {
    throw new Error('ECMWF: no GRIB messages returned (run may not be posted yet)');
  }
  const combined = Buffer.concat(messages);
  const globalGrid = await decodeUVGrib(combined, 'ecmwf', runUnix, fh);
  // Persist the global grid for future bbox changes. Fire-and-forget: a failed
  // write just means the next box re-downloads, and we don't want to add the
  // serialise cost to first-fill latency. Stale runs are pruned once per
  // refresh job (see route.ts), not here.
  void writeGlobalGrid(globalGrid).catch(() => {
    /* disk full / perm denied — in-memory crop below still serves this request */
  });
  return cropGrid(globalGrid, bbox);
}
