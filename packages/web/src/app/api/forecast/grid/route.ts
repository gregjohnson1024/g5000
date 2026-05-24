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
  // Optional bbox filter. When present, only a grid fetched for *that* ROI box
  // qualifies — so /chart's overlay and its slider/banner agree (both keyed on
  // the same box). Matched against the cache KEY bbox (model|fh|latMin|latMax|
  // lonMin|lonMax), within 0.01° to match the slider's availableHours tolerance.
  const num = (k: string): number | null => {
    const s = url.searchParams.get(k);
    if (s === null) return null;
    const n = Number(s);
    return Number.isFinite(n) ? n : null;
  };
  const bb = {
    latMin: num('latMin'),
    latMax: num('latMax'),
    lonMin: num('lonMin'),
    lonMax: num('lonMax'),
  };
  const hasBbox =
    bb.latMin !== null && bb.latMax !== null && bb.lonMin !== null && bb.lonMax !== null;
  const near = (a: number, b: number): boolean => Math.abs(a - b) < 0.01;

  // Find latest cache entry matching model + hour (+ bbox, when requested).
  let best: { at: number; grid: import('../../../../lib/wind-fetch').WindGrid } | undefined;
  for (const [key, v] of cache) {
    if (v.grid.model !== model) continue;
    if (v.grid.forecastHour !== hour) continue;
    if (hasBbox) {
      const p = key.split('|'); // model|fh|latMin|latMax|lonMin|lonMax
      if (p.length < 6) continue;
      if (
        !near(Number(p[2]), bb.latMin!) ||
        !near(Number(p[3]), bb.latMax!) ||
        !near(Number(p[4]), bb.lonMin!) ||
        !near(Number(p[5]), bb.lonMax!)
      ) {
        continue;
      }
    }
    if (!best || v.at > best.at) best = v;
  }
  if (!best) {
    return Response.json({ ok: false, error: { message: 'not cached' } }, { status: 404 });
  }
  return Response.json({ ok: true, grid: best.grid });
}
