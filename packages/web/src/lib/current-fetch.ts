/**
 * Copernicus Marine (CMEMS) surface-current grid fetch + persistent cache
 * for the chart overlay.
 *
 * NOAA retired the NOMADS RTOFS subset filter in early 2026, so we use
 * Copernicus Marine's global ocean physics analysis forecast product
 * (cmems_mod_glo_phy-cur_anfc_0.083deg_P1D-m — daily means, 1/12°, surface
 * depth). The Python `copernicusmarine` client handles authentication and
 * subsetting; this module shells out to a helper script that returns JSON.
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

// The dev server runs from apps/autopilot-server (its CWD), the Pi
// production build runs the same way, but standalone test runs (vitest)
// may run from the repo root. Walk a small set of candidate paths to
// find the helper script regardless of CWD.
const HELPER_SCRIPT = (() => {
  const candidates = [
    // From apps/autopilot-server (dev + prod runtime CWD)
    resolve(process.cwd(), '../../packages/web/scripts/fetch-copernicus-currents.py'),
    // From repo root (tests, manual invocation)
    resolve(process.cwd(), 'packages/web/scripts/fetch-copernicus-currents.py'),
    // From packages/web itself
    resolve(process.cwd(), 'scripts/fetch-copernicus-currents.py'),
  ];
  for (const p of candidates) if (existsSync(p)) return p;
  // Fall back to the apps/autopilot-server-relative path; the actual
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

function cacheKey(b: Bbox, dateUtc: string): string {
  return [
    'cmems',
    dateUtc,
    b.latMin.toFixed(2),
    b.latMax.toFixed(2),
    b.lonMin.toFixed(2),
    b.lonMax.toFixed(2),
  ].join('|');
}

function todayUtcDate(): string {
  const d = new Date();
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(d.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${dd}`;
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

  const key = cacheKey(bbox, dateUtc);
  const cached = currentCache.get(key);
  if (cached) return cached.grid;

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
  await currentCache.set(key, { at: Date.now(), grid });
  return grid;
}

export { todayUtcDate };
