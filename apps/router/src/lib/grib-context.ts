import type { WindField, CurrentField, Bbox } from '@g5000/grib';
import {
  fetchGfsBlobs,
  fetchEcmwfBlobs,
  fetchRtofsBlobs,
  runWgrib2,
  parseGrib2Json,
} from '@g5000/grib';
import { GRIB_CACHE } from './paths';

export async function loadWindFor(
  model: 'GFS' | 'ECMWF',
  bbox: Bbox,
  hours: number,
): Promise<WindField> {
  if (model === 'GFS') {
    const { cachedPaths, runDateUtc, runHourUtc } = await fetchGfsBlobs({
      bbox,
      hours,
      cacheRoot: GRIB_CACHE,
    });
    const runTime =
      Date.UTC(
        Number(runDateUtc.slice(0, 4)),
        Number(runDateUtc.slice(5, 7)) - 1,
        Number(runDateUtc.slice(8, 10)),
        runHourUtc,
      ) / 1000;
    const messages = (await Promise.all(cachedPaths.map((p) => runWgrib2(p)))).flat();
    return parseGrib2Json(messages, 'GFS', runTime) as WindField;
  }
  if (model === 'ECMWF') {
    const { cachedPaths, runDateUtc, runHourUtc } = await fetchEcmwfBlobs({
      bbox,
      hours,
      cacheRoot: GRIB_CACHE,
    });
    const runTime =
      Date.UTC(
        Number(runDateUtc.slice(0, 4)),
        Number(runDateUtc.slice(5, 7)) - 1,
        Number(runDateUtc.slice(8, 10)),
        runHourUtc,
      ) / 1000;
    const messages = (await Promise.all(cachedPaths.map((p) => runWgrib2(p)))).flat();
    return parseGrib2Json(messages, 'ECMWF', runTime) as WindField;
  }
  throw new Error(`loadWindFor: model ${model} not implemented`);
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
