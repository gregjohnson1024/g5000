import { cache } from '../../wind/route';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * GET /api/forecast/grid?model=&hour=
 *
 * Returns the most recently cached grid matching (model, forecast hour),
 * regardless of bbox. This is what /chart uses so the chart doesn't have
 * to match the /forecast tab's exact bbox.
 */
export async function GET(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const model = (url.searchParams.get('model') ?? '').toLowerCase();
  const hour = Number(url.searchParams.get('hour'));
  if (model !== 'gfs' && model !== 'ecmwf') {
    return Response.json(
      { ok: false, error: { message: 'model must be gfs or ecmwf' } },
      { status: 400 },
    );
  }
  if (!Number.isFinite(hour) || hour < 0) {
    return Response.json({ ok: false, error: { message: 'hour required' } }, { status: 400 });
  }
  // Find latest cache entry matching model + hour. Cache keys begin with
  // `<model>|<hour>|...` so a simple scan works.
  let best: { at: number; grid: import('../../../../lib/wind-fetch').WindGrid } | undefined;
  for (const [, v] of cache) {
    if (v.grid.model !== model) continue;
    if (v.grid.forecastHour !== hour) continue;
    if (!best || v.at > best.at) best = v;
  }
  if (!best) {
    return Response.json({ ok: false, error: { message: 'not cached' } }, { status: 404 });
  }
  return Response.json({ ok: true, grid: best.grid });
}
