import { writeFile, rm, readdir, readFile, mkdir } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import type { Bbox, WindGrid, WindModel } from './wind-fetch';

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

interface CacheEntry {
  at: number;
  grid: WindGrid;
}

class PersistentWindCache {
  private mem = new Map<string, CacheEntry>();

  get(key: string): CacheEntry | undefined {
    return this.mem.get(key);
  }
  has(key: string): boolean {
    return this.mem.has(key);
  }
  get size(): number {
    return this.mem.size;
  }
  delete(key: string): boolean {
    void this.removeFile(key);
    return this.mem.delete(key);
  }
  clear(): void {
    this.mem.clear();
  }
  entries(): IterableIterator<[string, CacheEntry]> {
    return this.mem.entries();
  }
  values(): IterableIterator<CacheEntry> {
    return this.mem.values();
  }
  keys(): IterableIterator<string> {
    return this.mem.keys();
  }
  [Symbol.iterator](): IterableIterator<[string, CacheEntry]> {
    return this.mem[Symbol.iterator]();
  }

  set(key: string, entry: CacheEntry): this {
    this.mem.set(key, entry);
    void this.persist(key, entry);
    return this;
  }

  /**
   * Delete entries whose validAt is older than `now - graceMs`. Returns the
   * number of entries pruned. validAt is the canonical "this forecast covers
   * time T" stamp — a forecast for noon UTC stops being useful a few hours
   * after noon, regardless of how recently we fetched it. We default to a
   * 6-hour grace so a freshly-arrived forecast hour isn't pruned the moment
   * the wall clock crosses its validity.
   */
  pruneStale(now: number = Date.now(), graceMs: number = 6 * 60 * 60_000): number {
    const cutoffSec = (now - graceMs) / 1000;
    let pruned = 0;
    for (const [key, entry] of this.mem) {
      if (entry.grid.validAt < cutoffSec) {
        this.mem.delete(key);
        void this.removeFile(key);
        pruned += 1;
      }
    }
    return pruned;
  }

  private fileFor(key: string): string {
    // Sanitise the key for the filesystem: pipes → underscores.
    return join(WIND_CACHE_DIR, key.replace(/\|/g, '_').replace(/[^\w.\-_]/g, '_') + '.json');
  }

  private async persist(key: string, entry: CacheEntry): Promise<void> {
    try {
      await mkdir(WIND_CACHE_DIR, { recursive: true });
      await writeFile(this.fileFor(key), JSON.stringify(entry));
    } catch {
      /* disk full or perm denied — in-memory still works */
    }
  }

  private async removeFile(key: string): Promise<void> {
    try {
      await rm(this.fileFor(key), { force: true });
    } catch {
      /* file missing already — best-effort */
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
          const k = `${g.model}|${g.forecastHour}|${g.lats[0]!.toFixed(2)}|${g.lats[g.lats.length - 1]!.toFixed(2)}|${g.lons[0]!.toFixed(2)}|${g.lons[g.lons.length - 1]!.toFixed(2)}`;
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
/**
 * From a set of candidate grids (already filtered to those covering the
 * requested bbox), pick one CONSISTENT time series to stack along the time
 * axis. Grids are grouped by exact extent + model run; we then choose the
 * group from the MOST RECENT run (tie-broken by most forecast hours).
 *
 * Two failure modes this prevents:
 *  - Mixing different actual extents that happen to share dimensions (same
 *    `lats.length × lons.length` but a different region) — stacking those
 *    produces a spatially incoherent field.
 *  - Preferring an OLDER run just because it has more cached hours. An old
 *    run's forecast window can end before the (near-future) departure time,
 *    so `interpolateWind` throws "out of range" at the start and the planner
 *    reports `no_wind`. The newest run's window always covers "now".
 *
 * Returns the chosen grids sorted by valid time and deduped (two fetches of
 * the same run+extent can supply the same hour), so the time axis is strictly
 * increasing.
 */
export function selectConsistentGrids(grids: WindGrid[]): WindGrid[] {
  if (grids.length === 0) return [];
  const groups = new Map<string, WindGrid[]>();
  for (const g of grids) {
    // Key on actual extent + resolution + run, so we never stack grids of a
    // different region OR a different grid resolution (the dimensions guard
    // the old code enforced as a separate mismatch check).
    const key = `${g.lats[0]},${g.lats[g.lats.length - 1]},${g.lons[0]},${g.lons[g.lons.length - 1]},${g.lats.length}x${g.lons.length},${g.runAt}`;
    const bucket = groups.get(key);
    if (bucket) bucket.push(g);
    else groups.set(key, [g]);
  }
  // Rank groups newest-run-first, then most hours. Prefer the newest run that
  // has ≥ 2 forecast hours: the forecast refresh writes a run's hours
  // progressively, so a run mid-publish can have only 1 cached hour while the
  // prior complete run (same ROI) is still present — picking the 1-hour run
  // would strand the planner on `no_wind`. Fall back to the newest group if
  // none yet has 2 (windFieldFromCache then surfaces the proper shortage).
  const ranked = [...groups.values()].sort(
    (a, b) => b[0]!.runAt - a[0]!.runAt || b.length - a.length,
  );
  const best = ranked.find((g) => g.length >= 2) ?? ranked[0] ?? [];
  const sorted = [...best].sort((a, b) => a.validAt - b.validAt);
  const seen = new Set<number>();
  const out: WindGrid[] = [];
  for (const g of sorted) {
    if (seen.has(g.validAt)) continue;
    seen.add(g.validAt);
    out.push(g);
  }
  return out;
}

export function windFieldFromCache(
  model: WindModel,
  requireBbox: Bbox,
): {
  lats: number[];
  lons: number[];
  times: number[];
  u: number[][][];
  v: number[][][];
  source: 'GFS' | 'ECMWF' | 'HRRR';
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
    // NOMADS snaps a requested bbox INWARD to the model's native grid (0.25°
    // for GFS), so a grid fetched for exactly this ROI ends up a fraction of a
    // cell smaller on every edge. A strict `lats[0] <= latMin` test then
    // rejects the planner's own auto-fetched grid — it can never satisfy its
    // own request for an arbitrary (non-grid-aligned) bbox. Allow up to one
    // grid spacing of shortfall. Safe because the planner pads the route by 2°
    // before requesting wind, so the sub-cell gap at the bbox edge is never
    // actually sampled (and propagate() drops any out-of-grid leg anyway).
    const dlat = lats.length > 1 ? Math.abs(lats[1]! - lats[0]!) : 0;
    const dlon = lons.length > 1 ? Math.abs(lons[1]! - lons[0]!) : 0;
    if (lats[0]! > requireBbox.latMin + dlat || lats[lats.length - 1]! < requireBbox.latMax - dlat)
      continue;
    if (lons[0]! > requireBbox.lonMin + dlon || lons[lons.length - 1]! < requireBbox.lonMax - dlon)
      continue;
    grids.push(v.grid);
  }
  if (grids.length < 2) {
    throw new Error(
      `windFieldFromCache: need ≥ 2 cached ${model.toUpperCase()} forecast hours covering bbox ` +
        `[${requireBbox.latMin.toFixed(1)}..${requireBbox.latMax.toFixed(1)}, ${requireBbox.lonMin.toFixed(1)}..${requireBbox.lonMax.toFixed(1)}], ` +
        `have ${grids.length}. Fetch more on the /forecast tab.`,
    );
  }
  const series = selectConsistentGrids(grids);
  if (series.length < 2) {
    throw new Error(
      `windFieldFromCache: need ≥ 2 cached ${model.toUpperCase()} forecast hours covering bbox ` +
        `[${requireBbox.latMin.toFixed(1)}..${requireBbox.latMax.toFixed(1)}, ${requireBbox.lonMin.toFixed(1)}..${requireBbox.lonMax.toFixed(1)}], ` +
        `have ${series.length}. Fetch more on the /forecast tab.`,
    );
  }
  const ref = series[0]!;
  return {
    lats: ref.lats,
    lons: ref.lons,
    times: series.map((g) => g.validAt),
    u: series.map((g) => g.u),
    v: series.map((g) => g.v),
    source: model === 'gfs' ? 'GFS' : model === 'hrrr' ? 'HRRR' : 'ECMWF',
    runTime: ref.runAt,
  };
}
