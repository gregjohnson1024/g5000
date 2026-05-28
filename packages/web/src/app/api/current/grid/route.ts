import { currentCache, gridMatchesBbox } from '../../../../lib/current-fetch';
import type { CurrentGrid } from '../../../../lib/current-fetch';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * GET /api/current/grid?day=N[&latMin&latMax&lonMin&lonMax]
 *
 * Returns the most recently cached CMEMS current grid for forecast day N
 * (0 = today UTC, 1 = tomorrow, ...). When a bbox is supplied, only a grid
 * whose extent matches that ROI is returned, so the overlay stays in step with
 * the ROI rather than showing whichever region was cached most recently.
 * Returns 404 if no matching entry exists — the caller should hit
 * /api/current/refresh first (or wait for the scheduled refresh).
 */
export async function GET(req: Request): Promise<Response> {
  await currentCache.hydrate();
  const url = new URL(req.url);
  const day = Number(url.searchParams.get('day') ?? '0');
  if (!Number.isInteger(day) || day < 0) {
    return Response.json(
      { ok: false, error: { message: 'day required (non-negative integer)' } },
      { status: 400 },
    );
  }
  // Optional ROI filter. CMEMS snaps the requested box to its 1/12° grid, so
  // match the cached grid's extent within a tolerance larger than one cell.
  const n = (k: string): number | null => {
    const raw = url.searchParams.get(k);
    if (raw == null) return null;
    const v = Number(raw);
    return Number.isFinite(v) ? v : null;
  };
  const latMin = n('latMin');
  const latMax = n('latMax');
  const lonMin = n('lonMin');
  const lonMax = n('lonMax');
  const wantBbox = latMin != null && latMax != null && lonMin != null && lonMax != null;
  // Same extent-within-tolerance definition the cache writer uses for dedup, so
  // a freshly-stored grid is always found by a read for the box it was fetched for.
  const matchesBbox = (g: CurrentGrid): boolean =>
    !wantBbox ||
    gridMatchesBbox(g, { latMin: latMin!, latMax: latMax!, lonMin: lonMin!, lonMax: lonMax! });
  let best: { at: number; grid: CurrentGrid } | undefined;
  for (const [, v] of currentCache.entries()) {
    if (v.grid.forecastDay !== day) continue;
    if (!matchesBbox(v.grid)) continue;
    if (!best || v.at > best.at) best = v;
  }
  if (!best) {
    return Response.json({ ok: false, error: { message: 'not cached' } }, { status: 404 });
  }
  return Response.json({ ok: true, grid: best.grid });
}
