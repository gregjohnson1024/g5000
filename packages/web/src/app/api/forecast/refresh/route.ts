import {
  fetchWindGrid,
  fetchWindGridEcmwf,
  windCache,
  type Bbox,
  type WindGrid,
  type WindModel,
} from '../../../../lib/wind-fetch';
import { cache, bboxKey } from '../../wind/route';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 300; // background job can run 30 s+

interface Body {
  bbox?: Bbox;
  models?: WindModel[];
  /** Forecast hours to pre-fetch. */
  hours?: number[];
}

// Concurrency cap. Each fetch can take 5–60 s depending on the model and
// whether eccodes parsing is involved; fanning all 100+ out at once saturates
// the autopilot's event loop and accept queue. At 4 the chart stays responsive
// and a full refresh finishes in ~1–2 min.
const CONCURRENCY = 4;

// Monotonic job token. Each POST bumps it; workers from a superseded job stop
// pulling new tasks, so rapid ROI drags don't stack overlapping fetch jobs.
let generation = 0;

async function runJob(
  gen: number,
  bbox: Bbox,
  models: WindModel[],
  hours: number[],
): Promise<void> {
  const tasks: Array<{ model: WindModel; hour: number }> = [];
  for (const model of models) {
    for (const hour of hours) tasks.push({ model, hour });
  }
  let nextIdx = 0;
  let ok = 0;
  let failed = 0;
  const worker = async (): Promise<void> => {
    while (true) {
      if (gen !== generation) return; // a newer refresh superseded us
      const idx = nextIdx++;
      if (idx >= tasks.length) return;
      const t = tasks[idx]!;
      try {
        const grid: WindGrid =
          t.model === 'ecmwf'
            ? await fetchWindGridEcmwf(bbox, t.hour)
            : await fetchWindGrid(bbox, t.hour);
        cache.set(bboxKey(t.model, bbox, grid.forecastHour), { at: Date.now(), grid });
        ok++;
      } catch {
        failed++;
      }
    }
  };
  try {
    await Promise.all(Array.from({ length: CONCURRENCY }, () => worker()));
    if (gen === generation) windCache.pruneStale();
  } catch {
    /* a detached background job must never throw out */
  }
  // eslint-disable-next-line no-console
  console.log(`[forecast/refresh] gen=${gen} done: ${ok} ok, ${failed} failed of ${tasks.length}`);
}

/**
 * POST /api/forecast/refresh
 *
 * Kicks off a background fetch of the requested (model, forecast hour)
 * combinations for `bbox` and returns 202 immediately. The fetch job runs on
 * the (long-lived) autopilot's event loop after the response is sent — so a
 * full 114-combo refresh no longer holds the HTTP connection open for minutes
 * and trip the cloudflared ~100 s proxy timeout (which returned 502 while the
 * work actually completed). Clients poll `/api/forecast/manifest` to see grids
 * land; the /chart wind overlay reads them via `/api/wind?cached=1`.
 *
 * Response: `{ ok: true, started: true, tasks }` (202).
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

  const myGen = ++generation;
  void runJob(myGen, bbox, models, hours);
  return Response.json(
    { ok: true, started: true, tasks: models.length * hours.length },
    { status: 202 },
  );
}
