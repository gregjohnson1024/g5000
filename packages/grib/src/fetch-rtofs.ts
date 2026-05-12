import type { Bbox } from './types.js';
import { cachePath, cacheStore, cacheHas, type CacheKey } from './cache.js';

const NOMADS = 'https://nomads.ncep.noaa.gov/cgi-bin/filter_rtofs_2d.pl';

export interface BuildRtofsUrlOpts {
  /** 'YYYY-MM-DD' UTC of the daily RTOFS run (00z). */
  runDateUtc: string;
  /** Forecast hour from run start. */
  forecastHour: number;
  bbox: Bbox;
}

export function buildRtofsUrl(o: BuildRtofsUrlOpts): string {
  const date = o.runDateUtc.replace(/-/g, '');
  const fff = `f${String(o.forecastHour).padStart(3, '0')}`;
  const params = new URLSearchParams();
  params.set('dir', `/rtofs.${date}`);
  params.set('file', `rtofs_glo_2ds_${fff}_diag.nc`);
  params.set('var_UOGRD', 'on');
  params.set('var_VOGRD', 'on');
  params.set('lev_surface', 'on');
  params.set('subregion', '');
  params.set('toplat', String(o.bbox.latMax));
  params.set('leftlon', String(o.bbox.lonMin));
  params.set('rightlon', String(o.bbox.lonMax));
  params.set('bottomlat', String(o.bbox.latMin));
  return `${NOMADS}?${params.toString()}`;
}

export interface FetchRtofsOpts {
  bbox: Bbox;
  /** Forecast horizon in hours from the run start. */
  hours: number;
  cacheRoot: string;
  /** Override fetch (for tests). Defaults to global fetch. */
  fetchImpl?: typeof fetch;
}

/**
 * High-level RTOFS fetch. RTOFS runs once daily at 00z and posts ~6h later;
 * if current UTC is earlier than 06:00, fall back to yesterday's run.
 * Fetches surface UOGRD/VOGRD at 3-hourly cadence and caches per forecast
 * hour.
 */
export async function fetchRtofsBlobs(opts: FetchRtofsOpts): Promise<{
  runDateUtc: string;
  cachedPaths: string[];
}> {
  const fetchFn = opts.fetchImpl ?? globalThis.fetch;
  const now = new Date();
  // RTOFS runs once daily (00z) and posts ~6h later. Use yesterday's run if
  // current UTC < 06:00.
  const d = new Date(now.getTime() - 6 * 60 * 60 * 1000);
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  const runDateUtc = `${y}-${m}-${day}`;
  const runTime = Date.UTC(y, d.getUTCMonth(), d.getUTCDate(), 0) / 1000;

  const cachedPaths: string[] = [];
  for (let h = 3; h <= opts.hours; h += 3) {
    const key: CacheKey = {
      model: 'rtofs',
      runTime: runTime + h * 3600,
      bbox: opts.bbox,
      variable: 'uogrd',
    };
    if (!cacheHas(opts.cacheRoot, key)) {
      const url = buildRtofsUrl({ runDateUtc, forecastHour: h, bbox: opts.bbox });
      const res = await fetchFn(url);
      if (!res.ok) {
        throw Object.assign(new Error(`RTOFS fetch failed: ${res.status}`), {
          kind: 'fetch_failed',
          source: 'RTOFS',
          status: res.status,
          retryable: res.status >= 500 || res.status === 408 || res.status === 429,
        });
      }
      const buf = Buffer.from(await res.arrayBuffer());
      await cacheStore(opts.cacheRoot, key, buf);
    }
    cachedPaths.push(cachePath(opts.cacheRoot, key));
  }
  return { runDateUtc, cachedPaths };
}
