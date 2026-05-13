import {
  fetchWindGrid,
  fetchWindGridEcmwf,
  type Bbox,
  type WindGrid,
  type WindModel,
} from '../../../lib/wind-fetch';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

// Process-level cache: model run + bbox + forecast hour → grid.
// Caches per server-lifetime; restart to refresh.
const cache = new Map<string, { at: number; grid: WindGrid }>();
const TTL_MS = 30 * 60 * 1000; // 30 min

function bboxKey(model: WindModel, b: Bbox, fh: number): string {
  return `${model}|${fh}|${b.latMin.toFixed(2)}|${b.latMax.toFixed(2)}|${b.lonMin.toFixed(2)}|${b.lonMax.toFixed(2)}`;
}

/**
 * GET /api/wind?lat=...&lon=...&hours=H&radius=R
 *
 * Returns a wind-component grid covering a box `±R` degrees around (lat,lon)
 * at forecast hour `H` of the most recent GFS run. The grid resolution is
 * GFS-native (0.25° = ~15 NM).
 *
 * Response shape: `WindGrid` JSON (`lats`, `lons`, `u`, `v`, `validAt`,
 * `runAt`, `forecastHour`).
 */
export async function GET(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const lat = Number(url.searchParams.get('lat'));
  const lon = Number(url.searchParams.get('lon'));
  const hours = Number(url.searchParams.get('hours') ?? '0');
  const radius = Number(url.searchParams.get('radius') ?? '6');
  const modelParam = (url.searchParams.get('model') ?? 'gfs').toLowerCase();
  const model: WindModel = modelParam === 'ecmwf' ? 'ecmwf' : 'gfs';
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
    return Response.json({ ok: false, error: { message: 'lat & lon required' } }, { status: 400 });
  }
  if (!Number.isFinite(hours) || hours < 0 || hours > 240) {
    return Response.json({ ok: false, error: { message: 'hours must be 0–240' } }, { status: 400 });
  }
  if (!Number.isFinite(radius) || radius <= 0 || radius > 20) {
    return Response.json({ ok: false, error: { message: 'radius must be 0–20°' } }, { status: 400 });
  }
  // Round hour to the nearest available step. GFS 0.25° has 1-h steps to
  // f120 and 3-h steps to f384; here we serve only 1-h steps.
  const fh = Math.max(0, Math.round(hours));
  const bbox: Bbox = {
    latMin: lat - radius,
    latMax: lat + radius,
    lonMin: lon - radius,
    lonMax: lon + radius,
  };
  const key = bboxKey(model, bbox, fh);
  const now = Date.now();
  const cached = cache.get(key);
  if (cached && now - cached.at < TTL_MS) {
    return Response.json({ ok: true, grid: cached.grid, cached: true });
  }
  try {
    const grid =
      model === 'ecmwf' ? await fetchWindGridEcmwf(bbox, fh) : await fetchWindGrid(bbox, fh);
    cache.set(key, { at: now, grid });
    return Response.json({ ok: true, grid, cached: false });
  } catch (e) {
    return Response.json(
      { ok: false, error: { message: e instanceof Error ? e.message : String(e) } },
      { status: 502 },
    );
  }
}
