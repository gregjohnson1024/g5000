import { mkdir, writeFile, readFile, readdir, rm, stat, utimes } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import type { Bbox, WindGrid } from './wind-fetch';

/**
 * On-disk cache of *global* decoded ECMWF grids.
 *
 * ECMWF Open Data has no server-side geographic subsetting, so every fetch
 * pulls the whole 0.25° globe (721×1440) and crops locally. The global field
 * for a given (run, forecast-hour) is identical regardless of which bbox the
 * user drew — so we cache the decoded global grid once and serve any bbox by
 * cropping from it. A bbox change then costs a disk read + an in-memory crop
 * of a few hundred points instead of a ~4 s re-download + re-decode.
 *
 * Format is a flat binary blob (NOT JSON): JSON.parse of a million-point grid
 * is itself slower than re-fetching. Coordinates are Float64 (so cropped
 * lat/lon values stay bit-identical across reads and don't trip the grid-match
 * checks in windFieldFromCache); the bulk u/v/msl values are Float32 (ample for
 * m/s winds and Pa pressure, ~12 MB/hour vs ~25–40 MB as JS number[][]). Reads
 * use a DataView and pull ONLY the ROI points, so a hit never materialises the
 * global array in memory.
 *
 * GFS is intentionally NOT cached here — NOMADS subsets server-side, so there
 * is no global GFS grid to keep; each bbox is its own small remote fetch.
 */

const DIR = join(
  process.env.G5000_ROUTER_ROOT ?? join(homedir(), '.g5000-router'),
  'ecmwf-global-cache',
);

const MAGIC = 0x47354557; // 'G5EW'
const VERSION = 1;
// Header is 40 bytes so the Float64 coord arrays that follow start 8-aligned.
const HEADER_BYTES = 40;

function fileFor(runAt: number, fh: number): string {
  return join(DIR, `ecmwf_${runAt}_${fh}.bin`);
}

function flatten(src: number[][], dst: Float32Array, nLats: number, nLons: number): void {
  for (let y = 0; y < nLats; y++) {
    const row = src[y]!;
    const base = y * nLons;
    for (let x = 0; x < nLons; x++) dst[base + x] = row[x] ?? NaN;
  }
}

/** Serialise a decoded *global* ECMWF grid to disk. Best-effort: callers
 *  fire-and-forget this, since a failed write just means the next bbox change
 *  re-downloads rather than hitting the cache. */
export async function writeGlobalGrid(grid: WindGrid): Promise<void> {
  const nLats = grid.lats.length;
  const nLons = grid.lons.length;
  const hasPrmsl = !!grid.prmsl;
  const valuesCount = nLats * nLons;
  const fieldCount = hasPrmsl ? 3 : 2;
  const total = HEADER_BYTES + (nLats + nLons) * 8 + fieldCount * valuesCount * 4;

  const ab = new ArrayBuffer(total);
  const dv = new DataView(ab);
  dv.setUint32(0, MAGIC, true);
  dv.setUint8(4, VERSION);
  dv.setUint8(5, hasPrmsl ? 1 : 0);
  dv.setFloat64(8, grid.runAt, true);
  dv.setFloat64(16, grid.validAt, true);
  dv.setInt32(24, grid.forecastHour, true);
  dv.setUint32(28, nLats, true);
  dv.setUint32(32, nLons, true);

  new Float64Array(ab, HEADER_BYTES, nLats).set(grid.lats);
  new Float64Array(ab, HEADER_BYTES + nLats * 8, nLons).set(grid.lons);

  let off = HEADER_BYTES + (nLats + nLons) * 8;
  flatten(grid.u, new Float32Array(ab, off, valuesCount), nLats, nLons);
  off += valuesCount * 4;
  flatten(grid.v, new Float32Array(ab, off, valuesCount), nLats, nLons);
  off += valuesCount * 4;
  if (hasPrmsl) flatten(grid.prmsl!, new Float32Array(ab, off, valuesCount), nLats, nLons);

  await mkdir(DIR, { recursive: true });
  await writeFile(fileFor(grid.runAt, grid.forecastHour), Buffer.from(ab));
}

/**
 * Read the cached global grid for (runAt, fh) and crop it to `bbox`, pulling
 * only the ROI points. Returns null on a cache miss, a corrupt/old file, or a
 * bbox that lies entirely outside the grid.
 */
export async function cropFromGlobalCache(
  runAt: number,
  fh: number,
  bbox: Bbox,
): Promise<WindGrid | null> {
  let buf: Buffer;
  try {
    buf = await readFile(fileFor(runAt, fh));
  } catch {
    return null;
  }
  if (buf.byteLength < HEADER_BYTES) return null;
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  if (dv.getUint32(0, true) !== MAGIC || dv.getUint8(4) !== VERSION) return null;
  const hasPrmsl = dv.getUint8(5) === 1;
  const fileRunAt = dv.getFloat64(8, true);
  const validAt = dv.getFloat64(16, true);
  const forecastHour = dv.getInt32(24, true);
  const nLats = dv.getUint32(28, true);
  const nLons = dv.getUint32(32, true);

  const latsOff = HEADER_BYTES;
  const lonsOff = HEADER_BYTES + nLats * 8;
  const latKeep: number[] = [];
  const latIdx: number[] = [];
  for (let i = 0; i < nLats; i++) {
    const lat = dv.getFloat64(latsOff + i * 8, true);
    if (lat >= bbox.latMin && lat <= bbox.latMax) {
      latKeep.push(lat);
      latIdx.push(i);
    }
  }
  const lonKeep: number[] = [];
  const lonIdx: number[] = [];
  for (let i = 0; i < nLons; i++) {
    const lon = dv.getFloat64(lonsOff + i * 8, true);
    if (lon >= bbox.lonMin && lon <= bbox.lonMax) {
      lonKeep.push(lon);
      lonIdx.push(i);
    }
  }
  if (latIdx.length === 0 || lonIdx.length === 0) return null;

  // Touch the file's mtime on a hit so the LRU cap treats "recently viewed" as
  // recently used (same trick as the satellite tile cache). Best-effort.
  const now = new Date();
  void utimes(fileFor(runAt, fh), now, now).catch(() => {});

  const valuesCount = nLats * nLons;
  const uOff = HEADER_BYTES + (nLats + nLons) * 8;
  const vOff = uOff + valuesCount * 4;
  const pOff = vOff + valuesCount * 4;
  const readField = (base: number): number[][] =>
    latIdx.map((yi) => lonIdx.map((xi) => dv.getFloat32(base + (yi * nLons + xi) * 4, true)));

  return {
    lats: latKeep,
    lons: lonKeep,
    u: readField(uOff),
    v: readField(vOff),
    prmsl: hasPrmsl ? readField(pOff) : undefined,
    validAt,
    runAt: fileRunAt,
    forecastHour,
    model: 'ecmwf',
  };
}

/**
 * Delete cached global grids that are no longer useful. A file goes if EITHER:
 *  - its valid time is older than `now - graceMs` (a past forecast hour), or
 *  - `minRunAt` is given and its run predates it (a superseded model run).
 *
 * The second rule matters: reads key on the *current* run, so once a newer run
 * publishes the old run's far-future hours would never be read again yet their
 * valid times sit in the future, so the time rule alone would orphan them on
 * disk for days. Both checks read runAt/fh straight from the filename
 * (validAt = runAt + fh·3600), so this never opens a file.
 */
export async function pruneGlobalCache(
  now: number = Date.now(),
  graceMs: number = 6 * 60 * 60_000,
  minRunAt?: number,
): Promise<number> {
  let files: string[];
  try {
    files = await readdir(DIR);
  } catch {
    return 0;
  }
  const cutoffSec = (now - graceMs) / 1000;
  let pruned = 0;
  for (const f of files) {
    const m = f.match(/^ecmwf_(\d+)_(\d+)\.bin$/);
    if (!m) continue;
    const runAt = Number(m[1]);
    const validAt = runAt + Number(m[2]) * 3600;
    const superseded = minRunAt !== undefined && runAt < minRunAt;
    if (validAt < cutoffSec || superseded) {
      try {
        await rm(join(DIR, f), { force: true });
        pruned += 1;
      } catch {
        /* best-effort */
      }
    }
  }
  return pruned;
}

/** Default LRU cap for the global cache — a backstop beyond the time-based prune. */
export const GLOBAL_CACHE_CAP_BYTES = 1024 ** 3; // 1 GiB

/**
 * Enforce a hard size cap on the global cache by evicting least-recently-used
 * grids (oldest mtime first; reads bump mtime) until the total is under
 * `maxBytes`. A backstop for the time-based prune — e.g. when many distinct
 * ROI boxes are fetched within one run so nothing is yet stale. Returns the
 * number of files evicted.
 */
export async function capGlobalCache(maxBytes: number = GLOBAL_CACHE_CAP_BYTES): Promise<number> {
  let files: string[];
  try {
    files = await readdir(DIR);
  } catch {
    return 0;
  }
  const entries: Array<{ path: string; size: number; mtime: number }> = [];
  let total = 0;
  for (const f of files) {
    if (!f.endsWith('.bin')) continue;
    try {
      const s = await stat(join(DIR, f));
      entries.push({ path: join(DIR, f), size: s.size, mtime: s.mtimeMs });
      total += s.size;
    } catch {
      /* vanished mid-scan — ignore */
    }
  }
  if (total <= maxBytes) return 0;
  entries.sort((a, b) => a.mtime - b.mtime); // least-recently-used first
  let evicted = 0;
  for (const e of entries) {
    if (total <= maxBytes) break;
    try {
      await rm(e.path, { force: true });
      total -= e.size;
      evicted += 1;
    } catch {
      /* best-effort */
    }
  }
  return evicted;
}
