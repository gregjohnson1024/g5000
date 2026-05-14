import { spawn } from 'node:child_process';
import { mkdtemp, writeFile, rm, readdir, readFile, mkdir } from 'node:fs/promises';
import { tmpdir, homedir } from 'node:os';
import { join } from 'node:path';
import { pickEcmwfRun } from '@g5000/grib';

// ECMWF Open Data IFS is mirrored on AWS S3 (public bucket, no auth, no rate
// limit). Prefer it over data.ecmwf.int which 429s aggressively after a
// handful of requests.
const ECMWF_S3 = 'https://ecmwf-forecasts.s3.eu-central-1.amazonaws.com';

interface EcmwfIndexLine {
  param: string;
  _offset: number;
  _length: number;
}

async function fetchEcmwfMessagesS3(opts: {
  runDateUtc: string;
  runHourUtc: 0 | 6 | 12 | 18;
  forecastHour: number;
  variables: Array<'10u' | '10v' | 'msl'>;
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
  const idxRes = await fetch(idxUrl, { signal: AbortSignal.timeout(30_000) });
  if (!idxRes.ok) {
    throw new Error(`ECMWF S3 index ${idxUrl} → ${idxRes.status}`);
  }
  const text = await idxRes.text();
  const lines = text
    .split(/\n/)
    .filter(Boolean)
    .map((l) => JSON.parse(l) as EcmwfIndexLine);
  const wanted = lines.filter((l) => opts.variables.includes(l.param as '10u' | '10v' | 'msl'));
  const buffers: Buffer[] = [];
  for (const w of wanted) {
    const res = await fetch(gribUrl, {
      headers: { Range: `bytes=${w._offset}-${w._offset + w._length - 1}` },
      signal: AbortSignal.timeout(30_000),
    });
    if (!(res.status === 200 || res.status === 206)) {
      throw new Error(`ECMWF S3 range fetch failed: ${res.status} for param=${w.param}`);
    }
    buffers.push(Buffer.from(await res.arrayBuffer()));
  }
  return buffers;
}

export type WindModel = 'gfs' | 'ecmwf';

// Persistent on-disk wind cache. Survives autopilot restarts so a planner
// can use yesterday's forecast immediately without re-fetching from
// NOMADS / S3. Entries hydrate on module load (eager) and write through
// on every `set`. The original Map is wrapped so existing callers like
// `cache.set(key, {at, grid})` and `cache.get(key)` keep working with no
// changes — disk persistence is a side-effect.
const WIND_CACHE_DIR = join(
  process.env.G5000_ROUTER_ROOT ?? join(homedir(), '.g5000-router'),
  'wind-cache',
);

interface CacheEntry { at: number; grid: WindGrid }

class PersistentWindCache {
  private mem = new Map<string, CacheEntry>();

  get(key: string): CacheEntry | undefined { return this.mem.get(key); }
  has(key: string): boolean { return this.mem.has(key); }
  get size(): number { return this.mem.size; }
  delete(key: string): boolean { return this.mem.delete(key); }
  clear(): void { this.mem.clear(); }
  entries(): IterableIterator<[string, CacheEntry]> { return this.mem.entries(); }
  values(): IterableIterator<CacheEntry> { return this.mem.values(); }
  keys(): IterableIterator<string> { return this.mem.keys(); }
  [Symbol.iterator](): IterableIterator<[string, CacheEntry]> { return this.mem[Symbol.iterator](); }

  set(key: string, entry: CacheEntry): this {
    this.mem.set(key, entry);
    void this.persist(key, entry);
    return this;
  }

  private async persist(key: string, entry: CacheEntry): Promise<void> {
    try {
      await mkdir(WIND_CACHE_DIR, { recursive: true });
      // Sanitise the key for the filesystem: pipes → underscores.
      const file = join(WIND_CACHE_DIR, key.replace(/\|/g, '_').replace(/[^\w.\-_]/g, '_') + '.json');
      await writeFile(file, JSON.stringify(entry));
    } catch {
      /* disk full or perm denied — in-memory still works */
    }
  }

  async hydrate(): Promise<number> {
    try {
      const files = await readdir(WIND_CACHE_DIR);
      let loaded = 0;
      for (const f of files) {
        if (!f.endsWith('.json')) continue;
        try {
          const raw = await readFile(join(WIND_CACHE_DIR, f), 'utf8');
          const entry = JSON.parse(raw) as CacheEntry;
          if (!entry?.grid?.model) continue;
          // Reverse the filename sanitisation. The pipes were the only
          // multi-char escape we did; everything else was already
          // filename-safe.
          const g = entry.grid;
          const k = `${g.model}|${g.forecastHour}|${g.lats[0]!.toFixed(2)}|${g.lats[g.lats.length-1]!.toFixed(2)}|${g.lons[0]!.toFixed(2)}|${g.lons[g.lons.length-1]!.toFixed(2)}`;
          this.mem.set(k, entry);
          loaded++;
        } catch {
          /* one bad file shouldn't sink the rest */
        }
      }
      return loaded;
    } catch {
      return 0;
    }
  }
}

export const windCache = new PersistentWindCache();
// Fire-and-forget hydrate on module load. Routes that touch the cache
// in the first few seconds after boot might miss disk entries; the
// hydrate finishes long before the boat's helmsman opens a tab.
void (async () => {
  const n = await windCache.hydrate();
  if (n > 0) {
    // eslint-disable-next-line no-console
    console.log(`[wind-cache] hydrated ${n} grid(s) from ${WIND_CACHE_DIR}`);
  }
})();

export function bboxKey(model: WindModel, b: Bbox, fh: number): string {
  return `${model}|${fh}|${b.latMin.toFixed(2)}|${b.latMax.toFixed(2)}|${b.lonMin.toFixed(2)}|${b.lonMax.toFixed(2)}`;
}

/**
 * Build a 3-D `WindField` (the format `@g5000/routing#plan` expects) from
 * the cached forecast hours of a given model. Selects entries whose bbox
 * contains the requested `requireBbox` (so a cache fetched for a wider ROI
 * is reusable), sorts by valid time, and stacks the u/v grids along a new
 * time axis. Throws if fewer than 2 forecast hours are cached — the
 * planner needs at least a start + step interpolation.
 */
export function windFieldFromCache(
  model: WindModel,
  requireBbox: Bbox,
): {
  lats: number[];
  lons: number[];
  times: number[];
  u: number[][][];
  v: number[][][];
  source: 'GFS' | 'ECMWF';
  runTime: number;
} {
  const grids: WindGrid[] = [];
  for (const [, v] of windCache) {
    if (v.grid.model !== model) continue;
    // Require the cached bbox to fully contain the requested ROI. Lats/lons
    // ascending in our grids, so check endpoints.
    const lats = v.grid.lats;
    const lons = v.grid.lons;
    if (lats.length === 0 || lons.length === 0) continue;
    if (lats[0]! > requireBbox.latMin || lats[lats.length - 1]! < requireBbox.latMax) continue;
    if (lons[0]! > requireBbox.lonMin || lons[lons.length - 1]! < requireBbox.lonMax) continue;
    grids.push(v.grid);
  }
  if (grids.length < 2) {
    throw new Error(
      `windFieldFromCache: need ≥ 2 cached ${model.toUpperCase()} forecast hours covering bbox ` +
        `[${requireBbox.latMin.toFixed(1)}..${requireBbox.latMax.toFixed(1)}, ${requireBbox.lonMin.toFixed(1)}..${requireBbox.lonMax.toFixed(1)}], ` +
        `have ${grids.length}. Fetch more on the /forecast tab.`,
    );
  }
  // All grids must share the same lats/lons. With our eccodes pipeline this
  // is true when they came from the same bbox fetch — but if a previous
  // refresh used a different ROI we'd see size drift. Reject mismatches up
  // front rather than silently producing a bad field.
  grids.sort((a, b) => a.validAt - b.validAt);
  const ref = grids[0]!;
  for (let i = 1; i < grids.length; i++) {
    const g = grids[i]!;
    if (g.lats.length !== ref.lats.length || g.lons.length !== ref.lons.length) {
      throw new Error(
        `windFieldFromCache: grid size mismatch between forecast hours ` +
          `(t=${ref.forecastHour}h: ${ref.lats.length}×${ref.lons.length}, ` +
          `t=${g.forecastHour}h: ${g.lats.length}×${g.lons.length}). ` +
          `Re-fetch ${model.toUpperCase()} for a single ROI on /forecast.`,
      );
    }
  }
  return {
    lats: ref.lats,
    lons: ref.lons,
    times: grids.map((g) => g.validAt),
    u: grids.map((g) => g.u),
    v: grids.map((g) => g.v),
    source: model === 'gfs' ? 'GFS' : 'ECMWF',
    runTime: ref.runAt,
  };
}

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

/**
 * Pick the most recently completed GFS 0p25 run for `forecastHour` ahead of
 * `at`. GFS runs at 00/06/12/18 UTC and the run becomes available ~3.5 h
 * after its nominal time.
 */
/** Hours of publication lag after a model's nominal run start. */
export const PUBLICATION_LAG_HOURS: Record<WindModel, number> = {
  gfs: 4,
  ecmwf: 6,
};

/**
 * For a given model and reference time, return the most-recently-available
 * run and the wall-clock time at which the next run becomes available.
 */
export function runAvailability(
  model: WindModel,
  at: Date = new Date(),
): { latestRunUnix: number; nextRunAvailableUnix: number } {
  const lag = PUBLICATION_LAG_HOURS[model];
  // Walk back `lag` hours; the run "before" that wall-clock time is the
  // most recent that's been fully published.
  const t = new Date(at.getTime() - lag * 3600 * 1000);
  const h = t.getUTCHours();
  let hh: 0 | 6 | 12 | 18;
  if (h >= 18) hh = 18;
  else if (h >= 12) hh = 12;
  else if (h >= 6) hh = 6;
  else hh = 0;
  const latestRunUnix =
    Date.UTC(t.getUTCFullYear(), t.getUTCMonth(), t.getUTCDate(), hh) / 1000;
  // Next nominal run after `latestRunUnix` is +6h; it becomes available `lag` h later.
  const nextRunNominal = latestRunUnix + 6 * 3600;
  const nextRunAvailableUnix = nextRunNominal + lag * 3600;
  return { latestRunUnix, nextRunAvailableUnix };
}

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
  // 60-s timeout for GFS NOMADS — it does its own server-side bbox subsetting
  // so the response can take a beat to assemble for larger ROIs.
  const resp = await fetch(url, { signal: AbortSignal.timeout(60_000) });
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
    const validAt = run.runUnix + forecastHour * 3600;
    return { lats, lons, u, v, prmsl, validAt, runAt: run.runUnix, forecastHour, model: 'gfs' };
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
    return { lats, lons, u, v, prmsl, validAt: runAt + fh * 3600, runAt, forecastHour: fh, model };
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
 * ECMWF's CDN is aggressively rate-limited. We retry up to two times on
 * a 429, with exponential backoff (4 s, 12 s). The underlying
 * fetchEcmwfMessages does not retry itself.
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
  const fh = Math.max(0, Math.round(forecastHour / 3) * 3);

  const messages = await fetchEcmwfMessagesS3({
    runDateUtc: run.runDateUtc,
    runHourUtc: run.runHourUtc,
    forecastHour: fh,
    variables: ['10u', '10v', 'msl'],
  });
  if (messages.length === 0) {
    throw new Error('ECMWF: no GRIB messages returned (run may not be posted yet)');
  }
  const combined = Buffer.concat(messages);
  const globalGrid = await decodeUVGrib(combined, 'ecmwf', runUnix, fh);
  return cropGrid(globalGrid, bbox);
}
