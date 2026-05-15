import { currentCache } from '../../../../lib/current-fetch';
import type { CurrentGrid } from '../../../../lib/current-fetch';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * GET /api/current/grid?day=N
 *
 * Returns the most recently cached CMEMS current grid for forecast day N
 * (0 = today UTC, 1 = tomorrow, ...), regardless of bbox. Returns 404 if
 * no cached entry exists yet — the caller should hit /api/current/refresh
 * first (or wait for the scheduled refresh).
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
  let best: { at: number; grid: CurrentGrid } | undefined;
  for (const [, v] of currentCache.entries()) {
    if (v.grid.forecastDay !== day) continue;
    if (!best || v.at > best.at) best = v;
  }
  if (!best) {
    return Response.json(
      { ok: false, error: { message: 'not cached' } },
      { status: 404 },
    );
  }
  return Response.json({ ok: true, grid: best.grid });
}
