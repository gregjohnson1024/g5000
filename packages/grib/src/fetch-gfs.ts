import { writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { WindField, Bbox } from './types.js';
import { cachePath, cacheStore, cacheHas, cacheRead, type CacheKey } from './cache.js';
import { parseGrib2Json } from './parse-grib2.js';
// runWgrib2 is fleshed out in Task 7b below; for now we keep this function
// at the URL/cache layer and integration tests exercise the parse path.

export interface BuildGfsUrlOpts {
  runDateUtc: string; // 'YYYY-MM-DD'
  runHourUtc: 0 | 6 | 12 | 18;
  forecastHour: number;
  variables: Array<'UGRD' | 'VGRD' | 'PRMSL'>;
  bbox: Bbox;
}

const NOMADS = 'https://nomads.ncep.noaa.gov/cgi-bin/filter_gfs_0p25.pl';

export function buildGfsUrl(o: BuildGfsUrlOpts): string {
  const dateNoDash = o.runDateUtc.replace(/-/g, '');
  const hh = String(o.runHourUtc).padStart(2, '0');
  const fff = String(o.forecastHour).padStart(3, '0');
  const params = new URLSearchParams();
  params.set('dir', `/gfs.${dateNoDash}/${hh}/atmos`);
  params.set('file', `gfs.t${hh}z.pgrb2.0p25.f${fff}`);
  for (const v of o.variables) params.set(`var_${v}`, 'on');
  if (o.variables.includes('UGRD') || o.variables.includes('VGRD')) {
    params.set('lev_10_m_above_ground', 'on');
  }
  if (o.variables.includes('PRMSL')) params.set('lev_mean_sea_level', 'on');
  // subregion subset
  params.set('subregion', '');
  params.set('toplat', String(o.bbox.latMax));
  params.set('leftlon', String(o.bbox.lonMin));
  params.set('rightlon', String(o.bbox.lonMax));
  params.set('bottomlat', String(o.bbox.latMin));
  return `${NOMADS}?${params.toString()}`;
}

/**
 * Choose the most recent GFS run that should be fully posted on NOMADS for
 * the given departure time. NOMADS typically posts runs ~3.5h after their
 * nominal start; we leave a 4h safety margin.
 */
export function pickGfsRunForDeparture(atUnixSec: number): {
  runDateUtc: string;
  runHourUtc: 0 | 6 | 12 | 18;
} {
  const lagMs = 4 * 60 * 60 * 1000;
  const d = new Date(atUnixSec * 1000 - lagMs);
  const hour = d.getUTCHours();
  const runHour = (Math.floor(hour / 6) * 6) as 0 | 6 | 12 | 18;
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return { runDateUtc: `${y}-${m}-${day}`, runHourUtc: runHour };
}

/**
 * GFS publishes f000…f120 hourly and f120…f384 every 3 hours.
 * Returns the forecast hour list spanning [startHour, endHour] (inclusive).
 */
export function gfsForecastHoursForRange(o: { startHour: number; endHour: number }): number[] {
  const out: number[] = [];
  for (let h = o.startHour; h <= Math.min(120, o.endHour); h++) out.push(h);
  for (let h = 123; h <= o.endHour; h += 3) out.push(h);
  return out;
}

export interface FetchGfsOpts {
  bbox: Bbox;
  /** Forecast horizon in hours from the run start. */
  hours: number;
  cacheRoot: string;
  /** Override fetch (for tests). Defaults to global fetch. */
  fetchImpl?: typeof fetch;
}

/**
 * High-level GFS fetch. Picks the latest run, builds per-forecast-hour URLs
 * for u10/v10, fetches each (with cache), and returns the concatenated set
 * of GRIB2 blobs. Parsing into a WindField is done in Task 7b after we wire
 * runWgrib2.
 */
export async function fetchGfsBlobs(o: FetchGfsOpts): Promise<{
  runDateUtc: string;
  runHourUtc: number;
  cachedPaths: string[];
}> {
  const fetchFn = o.fetchImpl ?? globalThis.fetch;
  const now = Math.floor(Date.now() / 1000);
  const run = pickGfsRunForDeparture(now);
  const hours = gfsForecastHoursForRange({ startHour: 0, endHour: o.hours });
  const runTime =
    Date.UTC(
      Number(run.runDateUtc.slice(0, 4)),
      Number(run.runDateUtc.slice(5, 7)) - 1,
      Number(run.runDateUtc.slice(8, 10)),
      run.runHourUtc,
    ) / 1000;

  const cachedPaths: string[] = [];
  for (const h of hours) {
    const variables = ['UGRD', 'VGRD'] as const;
    // We fetch u and v together (one URL); store as a single .grb2 per hour
    // under variable='u10' as the canonical name. We split out v10 only if
    // we later need per-variable caching.
    const key: CacheKey = {
      model: 'gfs',
      runTime: runTime + h * 3600,
      bbox: o.bbox,
      variable: 'u10',
    };
    if (!cacheHas(o.cacheRoot, key)) {
      const url = buildGfsUrl({
        runDateUtc: run.runDateUtc,
        runHourUtc: run.runHourUtc,
        forecastHour: h,
        variables: variables as unknown as Array<'UGRD' | 'VGRD'>,
        bbox: o.bbox,
      });
      const res = await fetchFn(url);
      if (!res.ok) {
        throw Object.assign(new Error(`GFS fetch failed: ${res.status}`), {
          kind: 'fetch_failed',
          source: 'GFS',
          status: res.status,
          retryable: res.status >= 500 || res.status === 408 || res.status === 429,
        });
      }
      const buf = Buffer.from(await res.arrayBuffer());
      await cacheStore(o.cacheRoot, key, buf);
    }
    cachedPaths.push(cachePath(o.cacheRoot, key));
  }
  return { runDateUtc: run.runDateUtc, runHourUtc: run.runHourUtc, cachedPaths };
}
