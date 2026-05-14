import { cache } from '../../wind/route';
import { runAvailability, type WindModel } from '../../../../lib/wind-fetch';

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
  for (const [, value] of cache) {
    const g = value.grid;
    entries.push({
      model: g.model,
      forecastHour: g.forecastHour,
      runAt: g.runAt,
      validAt: g.validAt,
      bbox: {
        latMin: g.lats[0] ?? 0,
        latMax: g.lats[g.lats.length - 1] ?? 0,
        lonMin: g.lons[0] ?? 0,
        lonMax: g.lons[g.lons.length - 1] ?? 0,
      },
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
  };
  return Response.json({ ok: true, entries, availability, nowUnix: Math.floor(now / 1000) });
}
