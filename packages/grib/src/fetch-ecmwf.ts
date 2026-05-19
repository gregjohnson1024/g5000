import type { Bbox } from './types.js';
import { cachePath, cacheStore, cacheHas } from './cache.js';

export interface BuildEcmwfUrlsOpts {
  runDateUtc: string; // YYYY-MM-DD
  runHourUtc: 0 | 6 | 12 | 18;
  forecastHour: number;
}

const ECMWF = 'https://data.ecmwf.int/forecasts';

export function buildEcmwfUrls(o: BuildEcmwfUrlsOpts): { grib: string; index: string } {
  const date = o.runDateUtc.replace(/-/g, '');
  const hh = String(o.runHourUtc).padStart(2, '0');
  const base = `${ECMWF}/${date}/${hh}z/ifs/0p25/oper`;
  const file = `${date}${hh}0000-${o.forecastHour}h-oper-fc`;
  return { grib: `${base}/${file}.grib2`, index: `${base}/${file}.index` };
}

/**
 * Choose the most recent ECMWF Open Data IFS run that should be fully posted
 * for the given time. ECMWF typically posts open-data runs ~6h after their
 * nominal start.
 */
export function pickEcmwfRun(atUnixSec: number): {
  runDateUtc: string;
  runHourUtc: 0 | 6 | 12 | 18;
} {
  const lagMs = 6 * 60 * 60 * 1000;
  const d = new Date(atUnixSec * 1000 - lagMs);
  const hour = d.getUTCHours();
  const runHour = (Math.floor(hour / 6) * 6) as 0 | 6 | 12 | 18;
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return { runDateUtc: `${y}-${m}-${day}`, runHourUtc: runHour };
}

interface IndexLine {
  _offset: number;
  _length: number;
  param: string;
  levelist?: string;
  levtype?: string;
}

/**
 * Fetch the ECMWF .index file for a single forecast step, then issue HTTP
 * Range requests to pull only the GRIB2 messages for the requested variables.
 * Returns one Buffer per matching index line.
 */
export async function fetchEcmwfMessages(opts: {
  runDateUtc: string;
  runHourUtc: 0 | 6 | 12 | 18;
  forecastHour: number;
  variables: Array<'10u' | '10v' | 'msl'>;
  fetchImpl?: typeof fetch;
}): Promise<Buffer[]> {
  const fetchFn = opts.fetchImpl ?? globalThis.fetch;
  const urls = buildEcmwfUrls(opts);
  const idxRes = await fetchFn(urls.index);
  if (!idxRes.ok) {
    throw Object.assign(new Error(`ECMWF index ${urls.index} → ${idxRes.status}`), {
      kind: 'fetch_failed',
      source: 'ECMWF',
      status: idxRes.status,
      retryable: idxRes.status >= 500 || idxRes.status === 408 || idxRes.status === 429,
    });
  }
  const text = await idxRes.text();
  const lines = text
    .split(/\n/)
    .filter(Boolean)
    .map((l) => JSON.parse(l) as IndexLine);
  const wanted = lines.filter((l) => opts.variables.includes(l.param as '10u' | '10v' | 'msl'));
  const buffers: Buffer[] = [];
  for (const w of wanted) {
    const res = await fetchFn(urls.grib, {
      headers: { Range: `bytes=${w._offset}-${w._offset + w._length - 1}` },
    });
    if (!(res.status === 200 || res.status === 206)) {
      throw Object.assign(new Error(`ECMWF range fetch failed: ${res.status}`), {
        kind: 'fetch_failed',
        source: 'ECMWF',
        status: res.status,
        retryable: res.status >= 500 || res.status === 408 || res.status === 429,
      });
    }
    buffers.push(Buffer.from(await res.arrayBuffer()));
  }
  return buffers;
}

export interface FetchEcmwfOpts {
  bbox: Bbox;
  /** Forecast horizon in hours from the run start. */
  hours: number;
  cacheRoot: string;
  /** Override fetch (for tests). Defaults to global fetch. */
  fetchImpl?: typeof fetch;
}

/**
 * High-level ECMWF fetch. Picks the latest run, walks 3-hourly steps up to
 * f144, and Range-GETs 10u/10v per step from data.ecmwf.int. Bbox is used
 * only for the cache key — spatial cropping is done post-fetch by wgrib2.
 */
export async function fetchEcmwfBlobs(opts: FetchEcmwfOpts): Promise<{
  runDateUtc: string;
  runHourUtc: number;
  cachedPaths: string[];
}> {
  const now = Math.floor(Date.now() / 1000);
  const run = pickEcmwfRun(now);
  const steps: number[] = [];
  for (let h = 0; h <= Math.min(144, opts.hours); h += 3) steps.push(h);
  const runTime =
    Date.UTC(
      Number(run.runDateUtc.slice(0, 4)),
      Number(run.runDateUtc.slice(5, 7)) - 1,
      Number(run.runDateUtc.slice(8, 10)),
      run.runHourUtc,
    ) / 1000;
  const cachedPaths: string[] = [];
  for (const h of steps) {
    const key = {
      model: 'ecmwf' as const,
      runTime: runTime + h * 3600,
      bbox: opts.bbox,
      variable: 'u10' as const,
    };
    if (!cacheHas(opts.cacheRoot, key)) {
      const buffers = await fetchEcmwfMessages({
        runDateUtc: run.runDateUtc,
        runHourUtc: run.runHourUtc,
        forecastHour: h,
        variables: ['10u', '10v'],
        fetchImpl: opts.fetchImpl,
      });
      const combined = Buffer.concat(buffers);
      await cacheStore(opts.cacheRoot, key, combined);
    }
    cachedPaths.push(cachePath(opts.cacheRoot, key));
  }
  return { runDateUtc: run.runDateUtc, runHourUtc: run.runHourUtc, cachedPaths };
}
