import type { WindField, CurrentField, Bbox } from '@g5000/grib';
import { fetchRtofsBlobs, runWgrib2, parseGrib2Json } from '@g5000/grib';
import {
  windFieldFromCache,
  fetchWindGrid,
  fetchWindGridEcmwf,
  windCache,
  bboxKey,
  type WindModel,
} from './wind-fetch';
import { GRIB_CACHE } from './paths';

/**
 * Wind loader for the routing planner.
 *
 * Reads from the in-memory `windCache` populated by /api/forecast/refresh
 * (eccodes-backed, ECMWF via the S3 mirror). The original wgrib2-based
 * path is gone — the Mac dev box doesn't have wgrib2 installed and we
 * have a cleaner option that doesn't require it. The cache must have at
 * least two forecast hours covering the requested bbox, which the
 * planner needs for time-interpolation of the wind field.
 *
 * The `hours` argument is the planner's max horizon; this function
 * doesn't enforce it — we just hand back whatever's cached and let the
 * planner stop when it runs out of forecast steps.
 */
// Hours to fetch when the cache is missing coverage. Mirrors the systemd
// timer's defaults — every 3 h out to +168 h. Concurrent fan-out of 4
// keeps wall-clock under ~90 s on a typical NOMADS day.
const ON_DEMAND_HOURS: number[] = Array.from({ length: 57 }, (_, i) => i * 3);
const ON_DEMAND_CONCURRENCY = 4;

async function autoFetch(model: WindModel, bbox: Bbox): Promise<void> {
  let nextIdx = 0;
  const worker = async (): Promise<void> => {
    while (true) {
      const idx = nextIdx++;
      if (idx >= ON_DEMAND_HOURS.length) return;
      const h = ON_DEMAND_HOURS[idx]!;
      try {
        const grid = model === 'ecmwf'
          ? await fetchWindGridEcmwf(bbox, h)
          : await fetchWindGrid(bbox, h);
        windCache.set(bboxKey(model, bbox, grid.forecastHour), {
          at: Date.now(),
          grid,
        });
      } catch {
        // One bad hour shouldn't sink the rest — ECMWF tail / NOMADS
        // 404 / flaky network are all expected.
      }
    }
  };
  await Promise.all(
    Array.from({ length: ON_DEMAND_CONCURRENCY }, () => worker()),
  );
}

export async function loadWindFor(
  model: 'GFS' | 'ECMWF',
  bbox: Bbox,
  hours: number,
): Promise<WindField> {
  void hours;
  const m: WindModel = model === 'GFS' ? 'gfs' : 'ecmwf';
  try {
    return windFieldFromCache(m, bbox) as WindField;
  } catch (e) {
    // Cache miss for this bbox. Auto-fetch on the planner's behalf —
    // 1–2 min wall-clock, but cheaper than asking the user to refresh.
    // eslint-disable-next-line no-console
    console.log(`[autopilot] route plan: on-demand ${m.toUpperCase()} fetch for bbox [${bbox.latMin.toFixed(1)}..${bbox.latMax.toFixed(1)}, ${bbox.lonMin.toFixed(1)}..${bbox.lonMax.toFixed(1)}] (${e instanceof Error ? e.message : String(e)})`);
    await autoFetch(m, bbox);
    // Retry the lookup; if it still fails, surface the original-style
    // error to the caller so the UI can show a meaningful message.
    return windFieldFromCache(m, bbox) as WindField;
  }
}

export async function loadCurrentFor(bbox: Bbox, hours: number): Promise<CurrentField> {
  const { cachedPaths, runDateUtc } = await fetchRtofsBlobs({
    bbox,
    hours,
    cacheRoot: GRIB_CACHE,
  });
  const runTime =
    Date.UTC(
      Number(runDateUtc.slice(0, 4)),
      Number(runDateUtc.slice(5, 7)) - 1,
      Number(runDateUtc.slice(8, 10)),
      0,
    ) / 1000;
  const messages = (await Promise.all(cachedPaths.map((p) => runWgrib2(p)))).flat();
  return parseGrib2Json(messages, 'RTOFS', runTime) as CurrentField;
}
