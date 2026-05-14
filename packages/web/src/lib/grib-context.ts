import type { WindField, CurrentField, Bbox } from '@g5000/grib';
import { fetchRtofsBlobs, runWgrib2, parseGrib2Json } from '@g5000/grib';
import { windFieldFromCache } from './wind-fetch';
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
export async function loadWindFor(
  model: 'GFS' | 'ECMWF',
  bbox: Bbox,
  hours: number,
): Promise<WindField> {
  void hours;
  return windFieldFromCache(model === 'GFS' ? 'gfs' : 'ecmwf', bbox) as WindField;
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
