import {
  fetchWindGrid,
  fetchWindGridEcmwf,
  type Bbox,
  type WindGrid,
  type WindModel,
} from '../../../../lib/wind-fetch';
import { cache, bboxKey } from '../../wind/route';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 300; // some fetches can take 30 s+

interface Body {
  bbox?: Bbox;
  models?: WindModel[];
  /** Forecast hours to pre-fetch. */
  hours?: number[];
}

/**
 * POST /api/forecast/refresh
 *
 * Fetches the requested (model, forecast hour) combinations for `bbox` and
 * stores them in the shared process cache. The /chart page's wind overlay
 * then reads from this cache via `/api/wind?cached=1`.
 *
 * Response: `{ ok, results: [{ model, hour, ok, runAt?, validAt?, error? }] }`.
 * The endpoint never fails wholesale — each combination has its own ok/error
 * so a partial fetch (e.g. GFS up but ECMWF lagged) still surfaces useful
 * grids.
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
  const models: WindModel[] = (body.models?.length ? body.models : ['gfs']).filter(
    (m) => m === 'gfs' || m === 'ecmwf',
  );
  const hours: number[] = (body.hours?.length ? body.hours : [0]).filter(
    (h) => Number.isFinite(h) && h >= 0 && h <= 240,
  );

  interface Result {
    model: WindModel;
    hour: number;
    ok: boolean;
    runAt?: number;
    validAt?: number;
    points?: number;
    error?: string;
  }
  const results: Result[] = [];
  // Fetch sequentially to avoid hammering NOMADS / ECMWF in parallel.
  for (const model of models) {
    for (const hour of hours) {
      try {
        const grid: WindGrid =
          model === 'ecmwf' ? await fetchWindGridEcmwf(bbox, hour) : await fetchWindGrid(bbox, hour);
        cache.set(bboxKey(model, bbox, grid.forecastHour), { at: Date.now(), grid });
        results.push({
          model,
          hour: grid.forecastHour,
          ok: true,
          runAt: grid.runAt,
          validAt: grid.validAt,
          points: grid.lats.length * grid.lons.length,
        });
      } catch (e) {
        results.push({
          model,
          hour,
          ok: false,
          error: e instanceof Error ? e.message : String(e),
        });
      }
    }
  }
  return Response.json({ ok: true, results });
}
