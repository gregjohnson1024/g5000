import {
  fetchWindGrid,
  fetchWindGridEcmwf,
  windCache,
  expectedRunUnix,
  type Bbox,
  type WindGrid,
  type WindModel,
} from '../../../../lib/wind-fetch';
import { fetchHrrrGrid, hrrrHorizonHours, pickHrrrRun, inHrrrDomain } from '../../../../lib/hrrr-fetch';
import { cache, bboxKey } from '../../wind/route';
import { pruneGlobalCache, capGlobalCache } from '../../../../lib/ecmwf-global-cache';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 300; // background job can run 30 s+

interface Body {
  bbox?: Bbox;
  models?: WindModel[];
  /** Forecast hours to pre-fetch. */
  hours?: number[];
}

// GFS (NOAA NOMADS) and ECMWF (ECMWF Open Data) are different servers, so each
// model gets its own worker pool and the two pools run concurrently — total
// wall-clock is bounded by the slower model, not the sum. Per-model caps keep
// the autopilot's event loop from saturating (peak ~7 concurrent fetches);
// ECMWF's is smaller because it rate-limits (429s) under load.
const POOL_CONCURRENCY: Record<WindModel, number> = { gfs: 4, ecmwf: 3, hrrr: 4 };

// Monotonic job token. Each POST bumps it; workers from a superseded job stop
// pulling new tasks, so rapid ROI drags don't stack overlapping fetch jobs.
let generation = 0;
// Aborts the in-flight downloads of the current job. A new POST or a DELETE
// aborts it so a superseded/cancelled refresh stops its network work in ms,
// not after its ~7 in-flight fetches time out.
let activeAbort: AbortController | null = null;

// Latest job's progress, polled by the chart's ROI progress bar via GET.
// `done` counts settled tasks (ok + failed) so it still reaches `total` even
// when ECMWF 404s for an unpublished run.
let progress: { gen: number; total: number; done: number; running: boolean } = {
  gen: 0,
  total: 0,
  done: 0,
  running: false,
};

/**
 * Valid forecast hours for a model, given the requested set. GFS 0.25° is
 * published hourly to f120 (then 3-hourly), so it takes every requested hour.
 * ECMWF open data is only published every 3 h, so drop non-multiples — without
 * this, an hourly request set hammers ECMWF with guaranteed-404 hours.
 */
function hoursForModel(model: WindModel, hours: number[]): number[] {
  if (model === 'ecmwf') return hours.filter((h) => h % 3 === 0);
  if (model === 'hrrr') {
    // HRRR is hourly but short-horizon: f00–f18 on most runs, f00–f48 only on
    // the synoptic 00/06/12/18z runs. Cap at the horizon of the run a fetch
    // would target now so we don't queue guaranteed-404 hours past the model's
    // window.
    const run = pickHrrrRun(Date.now() / 1000);
    const horizon = hrrrHorizonHours(run.runHourUtc);
    return hours.filter((h) => h <= horizon);
  }
  return hours;
}

async function runJob(
  gen: number,
  bbox: Bbox,
  models: WindModel[],
  hours: number[],
  signal: AbortSignal,
): Promise<void> {
  // The run a fetch would target right now, per model. An hour already cached
  // at this run is current — skip it (incremental refresh) so the 3 h timer
  // only downloads genuinely new data instead of all 114 grids every time.
  const expectedRun: Record<WindModel, number> = {
    gfs: expectedRunUnix('gfs'),
    ecmwf: expectedRunUnix('ecmwf'),
    hrrr: expectedRunUnix('hrrr'),
  };
  let settled = 0; // ok + failed + skipped, across both pools
  const fetchOne = async (model: WindModel, hour: number): Promise<void> => {
    const cached = cache.get(bboxKey(model, bbox, hour));
    if (cached && cached.grid.runAt === expectedRun[model]) {
      if (gen === generation) progress.done = ++settled; // already current — skip
      return;
    }
    try {
      const grid: WindGrid =
        model === 'ecmwf'
          ? await fetchWindGridEcmwf(bbox, hour, undefined, signal)
          : model === 'hrrr'
            ? await fetchHrrrGrid(bbox, hour, undefined, signal)
            : await fetchWindGrid(bbox, hour, undefined, signal);
      cache.set(bboxKey(model, bbox, grid.forecastHour), { at: Date.now(), grid });
    } catch {
      /* failed (ECMWF run unpublished) or aborted (superseded) — counts settled */
    }
    if (gen === generation) progress.done = ++settled;
  };
  // One pool per model, hitting its own server; pools run concurrently.
  const runPool = async (model: WindModel): Promise<void> => {
    const mHours = hoursForModel(model, hours);
    let nextIdx = 0;
    const worker = async (): Promise<void> => {
      while (true) {
        if (gen !== generation) return; // superseded by a newer refresh
        const idx = nextIdx++;
        if (idx >= mHours.length) return;
        await fetchOne(model, mHours[idx]!);
      }
    };
    await Promise.all(Array.from({ length: POOL_CONCURRENCY[model] }, () => worker()));
  };
  try {
    await Promise.all(models.map((m) => runPool(m)));
  } catch {
    /* a detached background job must never throw out */
  }
  if (gen === generation) {
    progress.done = settled;
    progress.running = false;
    windCache.pruneStale();
    // Drop superseded ECMWF runs + past-valid hours, then enforce the LRU size
    // cap as a backstop (many distinct ROI boxes in one run can outpace the
    // time-based prune).
    void pruneGlobalCache(Date.now(), undefined, expectedRun.ecmwf).then(() => capGlobalCache());
  }
  // eslint-disable-next-line no-console
  console.log(`[forecast/refresh] gen=${gen} done: ${settled} of ${models.length * hours.length}`);
}

/** GET /api/forecast/refresh — progress of the latest background refresh. */
export function GET(): Response {
  return Response.json({ ok: true, ...progress });
}

/**
 * DELETE /api/forecast/refresh — cancel the running refresh. Aborts in-flight
 * downloads and bumps the generation so workers stop pulling new tasks. Used by
 * the chart when the ROI changes, so a stale fetch doesn't keep downloading.
 */
export function DELETE(): Response {
  generation += 1;
  activeAbort?.abort();
  activeAbort = null;
  progress = { ...progress, running: false };
  return Response.json({ ok: true, cancelled: true });
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
    (m) =>
      m === 'gfs' ||
      m === 'ecmwf' ||
      // HRRR is CONUS-only; drop it for a mid-ocean box so the job doesn't queue
      // guaranteed-to-throw fetches.
      (m === 'hrrr' && inHrrrDomain(bbox)),
  );
  const hours: number[] = (body.hours?.length ? body.hours : [0]).filter(
    (h) => Number.isFinite(h) && h >= 0 && h <= 240,
  );

  const myGen = ++generation;
  const total = models.reduce((n, m) => n + hoursForModel(m, hours).length, 0);
  progress = { gen: myGen, total, done: 0, running: true };
  // Abort any prior job's in-flight downloads, then arm a fresh controller.
  activeAbort?.abort();
  const ac = new AbortController();
  activeAbort = ac;
  void runJob(myGen, bbox, models, hours, ac.signal);
  return Response.json({ ok: true, started: true, gen: myGen, tasks: total }, { status: 202 });
}
