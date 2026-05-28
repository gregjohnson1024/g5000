import { cache } from '../../wind/route';
import { runAvailability, expectedRunUnix, type WindModel } from '../../../../lib/wind-fetch';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

interface ManifestEntry {
  model: string;
  forecastHour: number;
  runAt: number;
  validAt: number;
  bbox: { latMin: number; latMax: number; lonMin: number; lonMax: number };
  fetchedAt: number;
  points: number;
}

/**
 * GET /api/forecast/manifest
 *
 * Returns the list of grids currently in the process-level wind cache.
 * Used by /chart to populate the model picker and timeline scrubber
 * without re-fetching.
 */
export async function GET(): Promise<Response> {
  const entries: ManifestEntry[] = [];
  for (const [key, value] of cache) {
    const g = value.grid;
    // Report the REQUESTED bbox (encoded in the cache key by bboxKey:
    // `model|fh|latMin|latMax|lonMin|lonMax`), not the grid's snapped extent —
    // so consumers can match an entry to the exact ROI that fetched it. Falls
    // back to the grid extent if the key is somehow malformed.
    const p = key.split('|');
    const bbox =
      p.length >= 6
        ? {
            latMin: Number(p[2]),
            latMax: Number(p[3]),
            lonMin: Number(p[4]),
            lonMax: Number(p[5]),
          }
        : {
            latMin: g.lats[0] ?? 0,
            latMax: g.lats[g.lats.length - 1] ?? 0,
            lonMin: g.lons[0] ?? 0,
            lonMax: g.lons[g.lons.length - 1] ?? 0,
          };
    entries.push({
      model: g.model,
      forecastHour: g.forecastHour,
      runAt: g.runAt,
      validAt: g.validAt,
      bbox,
      fetchedAt: value.at,
      points: g.lats.length * g.lons.length,
    });
  }
  // Stable order: model asc, forecastHour asc.
  entries.sort((a, b) => {
    if (a.model !== b.model) return a.model < b.model ? -1 : 1;
    return a.forecastHour - b.forecastHour;
  });
  const now = Date.now();
  const availability: Record<WindModel, { latestRunUnix: number; nextRunAvailableUnix: number }> = {
    gfs: runAvailability('gfs'),
    ecmwf: runAvailability('ecmwf'),
    hrrr: runAvailability('hrrr'),
  };
  // The run a fetch *right now* would actually target, per model. Use this —
  // not `availability.latestRunUnix` — to decide whether a newer run is
  // fetchable: `runAvailability` assumes a fixed publication lag that for ECMWF
  // is more optimistic than the conservative `pickEcmwfRun` the fetcher uses,
  // so the two disagree by a run cycle and the box looks perpetually stale.
  const expectedRun: Record<WindModel, number> = {
    gfs: expectedRunUnix('gfs'),
    ecmwf: expectedRunUnix('ecmwf'),
    hrrr: expectedRunUnix('hrrr'),
  };
  return Response.json({
    ok: true,
    entries,
    availability,
    expectedRun,
    nowUnix: Math.floor(now / 1000),
  });
}
