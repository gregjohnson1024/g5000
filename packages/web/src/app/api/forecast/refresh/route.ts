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
  // Concurrency cap. Each fetch can take 5–60 s depending on the model
  // and whether eccodes parsing is involved; fanning all 100+ out at once
  // saturates the autopilot's event loop and accept queue (we saw 500+
  // backlogged connections on the listen socket during one stall). At
  // CONCURRENCY=4 the total refresh time stays around 1–2 min and the
  // chart UI remains responsive throughout. Independent per (model, hour)
  // so a slow ECMWF fetch doesn't gate a fast GFS one.
  const CONCURRENCY = 4;
  type Task = { model: WindModel; hour: number };
  const tasks: Task[] = [];
  for (const model of models) {
    for (const hour of hours) tasks.push({ model, hour });
  }
  const results: Result[] = new Array(tasks.length);

  const runOne = async (idx: number, t: Task): Promise<void> => {
    try {
      const grid: WindGrid =
        t.model === 'ecmwf'
          ? await fetchWindGridEcmwf(bbox, t.hour)
          : await fetchWindGrid(bbox, t.hour);
      cache.set(bboxKey(t.model, bbox, grid.forecastHour), { at: Date.now(), grid });
      results[idx] = {
        model: t.model,
        hour: grid.forecastHour,
        ok: true,
        runAt: grid.runAt,
        validAt: grid.validAt,
        points: grid.lats.length * grid.lons.length,
      };
    } catch (e) {
      const raw = e instanceof Error ? e.message : String(e);
      const msg = /\b429\b/.test(raw)
        ? 'ECMWF rate-limited after retries — wait 1 min, fetch fewer hours, or use GFS'
        : raw;
      results[idx] = { model: t.model, hour: t.hour, ok: false, error: msg };
    }
  };

  let nextIdx = 0;
  const worker = async (): Promise<void> => {
    while (true) {
      const idx = nextIdx++;
      if (idx >= tasks.length) return;
      await runOne(idx, tasks[idx]!);
    }
  };
  await Promise.all(Array.from({ length: CONCURRENCY }, () => worker()));
  return Response.json({ ok: true, results });
}
