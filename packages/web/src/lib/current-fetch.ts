/**
 * Copernicus Marine (CMEMS) surface-current grid fetch + persistent cache
 * for the chart overlay.
 *
 * Source is Copernicus Marine's global ocean physics analysis forecast
 * product (cmems_mod_glo_phy-cur_anfc_0.083deg_P1D-m — daily means, 1/12°,
 * surface depth). The Python `copernicusmarine` client handles authentication
 * and subsetting; this module shells out to a helper script that returns JSON.
 */

import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import type { Bbox } from '@g5000/grib';

export interface CurrentGrid {
  /** Sorted ascending; len = u/v rows. */
  lats: number[];
  /** Sorted ascending; len = u/v cols. */
  lons: number[];
  /** Eastward component, m/s. Indexed [latIdx][lonIdx]. */
  u: number[][];
  /** Northward component, m/s. Indexed [latIdx][lonIdx]. */
  v: number[][];
  /** UTC seconds for the valid time (midnight UTC of the represented day). */
  validAt: number;
  /** Same as validAt for daily-mean data. */
  runAt: number;
  /** Days ahead from "today" — 0 for the current day. */
  forecastDay: number;
  source: 'CMEMS';
}

interface CacheEntry {
  at: number;
  grid: CurrentGrid;
}

const G5000_ROOT = process.env.G5000_ROUTER_ROOT ?? join(homedir(), '.g5000-router');
const CURRENT_CACHE_DIR = join(G5000_ROOT, 'current-cache');

// The dev server runs from apps/g5000 (its CWD), the Pi
// production build runs the same way, but standalone test runs (vitest)
// may run from the repo root. Walk a small set of candidate paths to
// find the helper script regardless of CWD.
const HELPER_SCRIPT = (() => {
  const candidates = [
    // From apps/g5000 (dev + prod runtime CWD)
    resolve(process.cwd(), '../../packages/web/scripts/fetch-copernicus-currents.py'),
    // From repo root (tests, manual invocation)
    resolve(process.cwd(), 'packages/web/scripts/fetch-copernicus-currents.py'),
    // From packages/web itself
    resolve(process.cwd(), 'scripts/fetch-copernicus-currents.py'),
  ];
  for (const p of candidates) if (existsSync(p)) return p;
  // Fall back to the apps/g5000-relative path; the actual
  // failure will surface as a clearer error from the spawned process.
  return candidates[0]!;
})();

// The `copernicusmarine` package pulls in modern numpy/xarray; on Macs with
// anaconda installed system-wide, anaconda's older bottleneck (built against
// numpy 1.x) crashes at import time. We install copernicusmarine into a
// dedicated venv on each host (Mac + Pi) and call its Python directly. Path
// is overridable via env for non-standard setups.
const VENV_PYTHON =
  process.env.COPERNICUSMARINE_PYTHON ??
  join(homedir(), '.copernicusmarine-venv', 'bin', 'python3');

class PersistentCurrentCache {
  private mem = new Map<string, CacheEntry>();
  private hydrated = false;

  async hydrate(): Promise<void> {
    if (this.hydrated) return;
    this.hydrated = true;
    try {
      const files = await readdir(CURRENT_CACHE_DIR);
      for (const f of files) {
        if (!f.endsWith('.json')) continue;
        try {
          const raw = await readFile(join(CURRENT_CACHE_DIR, f), 'utf8');
          this.mem.set(f.slice(0, -5), JSON.parse(raw) as CacheEntry);
        } catch {
          /* skip bad cache entries */
        }
      }
    } catch {
      /* dir missing — first run */
    }
  }

  get(key: string): CacheEntry | undefined {
    return this.mem.get(key);
  }

  has(key: string): boolean {
    return this.mem.has(key);
  }

  *entries(): Iterable<[string, CacheEntry]> {
    yield* this.mem.entries();
  }

  *values(): Iterable<CacheEntry> {
    yield* this.mem.values();
  }

  async set(key: string, entry: CacheEntry): Promise<void> {
    this.mem.set(key, entry);
    try {
      await mkdir(CURRENT_CACHE_DIR, { recursive: true });
      await writeFile(join(CURRENT_CACHE_DIR, `${key}.json`), JSON.stringify(entry));
    } catch (err) {
      console.warn('[current-cache] persist failed:', (err as Error).message);
    }
  }

  /**
   * Delete entries whose validAt is older than `now - graceMs`. CMEMS data
   * is daily-mean so the grace defaults to 36 h — yesterday's grid stays
   * useful through "today" because the boat may still be using it for
   * interpolation against today's grid.
   */
  async pruneStale(now: number = Date.now(), graceMs: number = 36 * 60 * 60_000): Promise<number> {
    const cutoffSec = (now - graceMs) / 1000;
    let pruned = 0;
    for (const [key, entry] of this.mem) {
      if (entry.grid.validAt < cutoffSec) {
        this.mem.delete(key);
        try {
          await rm(join(CURRENT_CACHE_DIR, `${key}.json`), { force: true });
        } catch {
          /* best-effort */
        }
        pruned += 1;
      }
    }
    return pruned;
  }
}

export const currentCache = new PersistentCurrentCache();
void currentCache.hydrate();

/**
 * Tolerance (degrees) for treating a cached grid's extent as "the same region"
 * as a requested bbox. CMEMS snaps requests to its 1/12° (~0.083°) grid and its
 * boundary rule can drop the edge cell, so the returned extent can sit up to ~1
 * cell inside the request. 0.25° (3 cells) absorbs that without over-matching a
 * genuinely different ROI. The read route and the pre-fetch dedup share this so
 * write-identity and read-identity agree.
 */
export const CMEMS_BBOX_TOL = 0.25;

/** Actual geographic extent of a grid, from its (ascending) lat/lon arrays. */
function gridExtent(g: { lats: number[]; lons: number[] }): {
  latMin: number;
  latMax: number;
  lonMin: number;
  lonMax: number;
} {
  return {
    latMin: g.lats[0] ?? NaN,
    latMax: g.lats[g.lats.length - 1] ?? NaN,
    lonMin: g.lons[0] ?? NaN,
    lonMax: g.lons[g.lons.length - 1] ?? NaN,
  };
}

/**
 * True when a grid's actual extent matches the requested bbox within `tol`.
 * This is the single definition of "this grid covers that ROI" — shared by the
 * read route (so the overlay stays in step with the ROI) and the pre-fetch
 * dedup (so a jittered ROI reuses an existing grid instead of re-fetching).
 */
export function gridMatchesBbox(
  g: { lats: number[]; lons: number[] },
  b: Bbox,
  tol: number = CMEMS_BBOX_TOL,
): boolean {
  const e = gridExtent(g);
  return (
    Math.abs(e.latMin - b.latMin) <= tol &&
    Math.abs(e.latMax - b.latMax) <= tol &&
    Math.abs(e.lonMin - b.lonMin) <= tol &&
    Math.abs(e.lonMax - b.lonMax) <= tol
  );
}

/**
 * Persistent-cache key for a grid, derived from the grid's ACTUAL extent (not
 * the requested bbox). CMEMS decides the returned extent, so keying on it makes
 * the storage key equal the identity the read route matches on — and collapses
 * near-duplicate requests (sub-cell ROI drags) that return the same grid onto a
 * single entry instead of one slow re-fetch per jitter.
 */
export function gridExtentKey(g: { lats: number[]; lons: number[] }, dateUtc: string): string {
  const e = gridExtent(g);
  return [
    'cmems',
    dateUtc,
    e.latMin.toFixed(2),
    e.latMax.toFixed(2),
    e.lonMin.toFixed(2),
    e.lonMax.toFixed(2),
  ].join('|');
}

/**
 * Find a cached grid that already satisfies a request: same forecast day, same
 * represented day (validAt — guards against serving an earlier day's grid), and
 * an extent within `tol` of the requested bbox. Returns null when none qualify.
 */
export function findReusableGrid(
  grids: Iterable<CurrentGrid>,
  bbox: Bbox,
  forecastDay: number,
  validAt: number,
  tol: number = CMEMS_BBOX_TOL,
): CurrentGrid | null {
  for (const g of grids) {
    if (g.forecastDay !== forecastDay) continue;
    if (g.validAt !== validAt) continue;
    if (gridMatchesBbox(g, bbox, tol)) return g;
  }
  return null;
}

/**
 * Spawn the Python helper to fetch + parse a Copernicus Marine current
 * grid for the given bbox + day. Returns the parsed JSON.
 *
 * The helper takes ~10-30 s on first run (CMEMS S3 fetch + xarray load);
 * cached responses are instant. Failures bubble up as Error with the
 * stderr captured.
 */
function spawnFetcher(
  bbox: Bbox,
  dateUtc: string,
): Promise<{
  lats: number[];
  lons: number[];
  u: number[][];
  v: number[][];
  runAt: number;
  validAt: number;
}> {
  return new Promise((resolve, reject) => {
    const args = [
      HELPER_SCRIPT,
      String(bbox.latMin),
      String(bbox.latMax),
      String(bbox.lonMin),
      String(bbox.lonMax),
      dateUtc,
    ];
    const child = spawn(VENV_PYTHON, args, {
      env: process.env,
    });
    const out: Buffer[] = [];
    const err: Buffer[] = [];
    child.stdout.on('data', (d: Buffer) => out.push(d));
    child.stderr.on('data', (d: Buffer) => err.push(d));
    child.on('error', reject);
    child.on('close', (code) => {
      if (code !== 0) {
        const msg = Buffer.concat(err).toString().trim() || `helper exited ${code}`;
        reject(new Error(msg));
        return;
      }
      try {
        const text = Buffer.concat(out).toString();
        resolve(JSON.parse(text));
      } catch (parseErr) {
        reject(parseErr instanceof Error ? parseErr : new Error(String(parseErr)));
      }
    });
  });
}

/**
 * Fetch (or read from cache) the surface-current grid for the given bbox
 * and forecastDay (0 = today UTC, 1 = tomorrow, ...). Returns the cropped
 * CurrentGrid ready to ship to the chart overlay.
 */
export async function fetchCurrentGrid(bbox: Bbox, forecastDay = 0): Promise<CurrentGrid> {
  await currentCache.hydrate();
  const base = new Date();
  base.setUTCDate(base.getUTCDate() + forecastDay);
  const y = base.getUTCFullYear();
  const m = String(base.getUTCMonth() + 1).padStart(2, '0');
  const d = String(base.getUTCDate()).padStart(2, '0');
  const dateUtc = `${y}-${m}-${d}`;
  // CMEMS daily-mean validAt is midnight UTC of the represented day — the same
  // stamp the Python helper writes, so equality below is exact.
  const targetValidAt = Math.floor(Date.UTC(y, base.getUTCMonth(), base.getUTCDate()) / 1000);

  // Reuse an existing grid that already covers this ROI (within tolerance) for
  // the same day. A sub-cell ROI nudge would otherwise mint a fresh request and
  // pay another 10-30 s CMEMS S3 subset for a byte-identical grid.
  const cachedGrids = (function* () {
    for (const e of currentCache.values()) yield e.grid;
  })();
  const reusable = findReusableGrid(cachedGrids, bbox, forecastDay, targetValidAt);
  if (reusable) return reusable;

  const parsed = await spawnFetcher(bbox, dateUtc);
  const grid: CurrentGrid = {
    lats: parsed.lats,
    lons: parsed.lons,
    u: parsed.u,
    v: parsed.v,
    validAt: parsed.validAt,
    runAt: parsed.runAt,
    forecastDay,
    source: 'CMEMS',
  };
  // Key on the RETURNED extent, not the request — so the storage key equals the
  // identity the read route matches on (bbox ≡ cache key).
  await currentCache.set(gridExtentKey(grid, dateUtc), { at: Date.now(), grid });
  return grid;
}
