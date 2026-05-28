import {
  fetchWindGrid,
  fetchWindGridEcmwf,
  windCache,
  bboxKey,
  type Bbox,
  type WindModel,
} from '../../../lib/wind-fetch';
import { fetchHrrrGrid } from '../../../lib/hrrr-fetch';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

// Re-export the shared cache + key fn so /api/forecast/* routes that
// already import from this path keep working unchanged.
export { windCache as cache, bboxKey };

const TTL_MS = 30 * 60 * 1000; // 30 min

/**
 * GET /api/wind?lat=...&lon=...&hours=H&radius=R
 *
 * Returns a wind-component grid covering a box `±R` degrees around (lat,lon)
 * at forecast hour `H` of the most recent run. With `cached=1`, returns 404
 * on miss instead of fetching (so /chart never triggers a fresh download).
 */
export async function GET(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const lat = Number(url.searchParams.get('lat'));
  const lon = Number(url.searchParams.get('lon'));
  const hours = Number(url.searchParams.get('hours') ?? '0');
  const radius = Number(url.searchParams.get('radius') ?? '6');
  const modelParam = (url.searchParams.get('model') ?? 'gfs').toLowerCase();
  const model: WindModel =
    modelParam === 'ecmwf' ? 'ecmwf' : modelParam === 'hrrr' ? 'hrrr' : 'gfs';
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
    return Response.json({ ok: false, error: { message: 'lat & lon required' } }, { status: 400 });
  }
  if (!Number.isFinite(hours) || hours < 0 || hours > 240) {
    return Response.json({ ok: false, error: { message: 'hours must be 0–240' } }, { status: 400 });
  }
  if (!Number.isFinite(radius) || radius <= 0 || radius > 20) {
    return Response.json(
      { ok: false, error: { message: 'radius must be 0–20°' } },
      { status: 400 },
    );
  }
  const fh = Math.max(0, Math.round(hours));
  const bbox: Bbox = {
    latMin: lat - radius,
    latMax: lat + radius,
    lonMin: lon - radius,
    lonMax: lon + radius,
  };
  const cachedOnly = url.searchParams.get('cached') === '1';
  const key = bboxKey(model, bbox, fh);
  const now = Date.now();
  const cached = windCache.get(key);
  if (cached && now - cached.at < TTL_MS) {
    return Response.json({ ok: true, grid: cached.grid, cached: true });
  }
  if (cachedOnly) {
    return Response.json(
      { ok: false, error: { message: 'not in cache; fetch via /forecast tab' } },
      { status: 404 },
    );
  }
  try {
    const grid =
      model === 'ecmwf'
        ? await fetchWindGridEcmwf(bbox, fh)
        : model === 'hrrr'
          ? await fetchHrrrGrid(bbox, fh)
          : await fetchWindGrid(bbox, fh);
    windCache.set(key, { at: now, grid });
    return Response.json({ ok: true, grid, cached: false });
  } catch (e) {
    return Response.json(
      { ok: false, error: { message: e instanceof Error ? e.message : String(e) } },
      { status: 502 },
    );
  }
}
