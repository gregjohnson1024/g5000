import { currentCache, fetchCurrentGrid } from '../../../../lib/current-fetch';
import type { Bbox } from '@g5000/grib';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 300;

interface Body {
  bbox?: Bbox;
  /** Days ahead from today UTC. Default: [0] (today only). 0..9 valid. */
  days?: number[];
}

/**
 * POST /api/current/refresh
 *
 * Fetches Copernicus Marine (CMEMS) surface-current grids for `bbox` for
 * the requested forecast days and stores them in the persistent cache.
 * The chart's CurrentOverlay then reads via `/api/current/grid`. Per-day
 * ok/error so a single failed day doesn't take down the whole refresh.
 */
export async function POST(req: Request): Promise<Response> {
  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return Response.json({ ok: false, error: { message: 'invalid JSON' } }, { status: 400 });
  }
  const bbox = body.bbox;
  if (
    !bbox ||
    typeof bbox.latMin !== 'number' ||
    typeof bbox.latMax !== 'number' ||
    typeof bbox.lonMin !== 'number' ||
    typeof bbox.lonMax !== 'number'
  ) {
    return Response.json({ ok: false, error: { message: 'bbox required' } }, { status: 422 });
  }
  if (bbox.latMin >= bbox.latMax || bbox.lonMin >= bbox.lonMax) {
    return Response.json({ ok: false, error: { message: 'bbox is degenerate' } }, { status: 422 });
  }
  const days = (body.days?.length ? body.days : [0]).filter(
    (d) => Number.isInteger(d) && d >= 0 && d <= 9,
  );

  // Drop grids whose represented day has aged out before we add today's. Without
  // this the current cache grows unbounded — unlike the wind cache, nothing else
  // ever calls pruneStale(). Fire-and-forget; a slow prune mustn't delay the fetch.
  void currentCache.pruneStale();

  interface R {
    day: number;
    ok: boolean;
    runAt?: number;
    validAt?: number;
    points?: number;
    error?: string;
  }
  const results: R[] = [];
  // Serialize — CMEMS S3 subset requests are slow on a flaky uplink (10-30 s
  // each on Starlink), and the helper script spawns a Python process per
  // call, so concurrent requests would dogpile.
  for (const day of days) {
    try {
      const grid = await fetchCurrentGrid(bbox, day);
      results.push({
        day,
        ok: true,
        runAt: grid.runAt,
        validAt: grid.validAt,
        points: grid.lats.length * grid.lons.length,
      });
    } catch (err) {
      results.push({
        day,
        ok: false,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
  return Response.json({ ok: true, results });
}
