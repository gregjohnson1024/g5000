import { getSharedConfigStore, type WindMisalignmentCal } from '@g5000/db';
import { applyMisalignmentCal } from '@g5000/compute';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

// Structural mirror of the controller in apps/g5000/src/wind-cal-run.ts.
// packages/web can't import the app package, so the controller is shared via
// a globalThis singleton — same pattern as __g5000_alarms_config_ref__.
interface WindCalRunResult {
  awsBins: number[];
  awaOffsetRad: number[];
  quality: {
    minSamplesPerBucket: number;
    bins: Array<{ awsBin: number; samplesPort: number; samplesStarboard: number }>;
  };
}

interface WindCalRunStatus {
  running: boolean;
  startedAt: number | null;
  awsBins: number[];
  counts: { port: number[]; starboard: number[] };
  previewOffsetRad: (number | null)[];
  minSamplesPerBucket: number;
  result: WindCalRunResult | null;
}

interface WindCalRunController {
  start(): WindCalRunStatus;
  stop(): WindCalRunStatus;
  abort(): WindCalRunStatus;
  status(): WindCalRunStatus;
  result(): WindMisalignmentCal | null;
}

function getController(): WindCalRunController | null {
  const g = globalThis as { __g5000_windCalRun__?: WindCalRunController };
  return g.__g5000_windCalRun__ ?? null;
}

export async function GET(): Promise<Response> {
  const c = getController();
  if (!c) {
    return Response.json(
      { ok: false, error: { message: 'wind-cal run controller not initialised' } },
      { status: 503 },
    );
  }
  return Response.json({ ok: true, status: c.status() });
}

interface PostBody {
  action: 'start' | 'stop' | 'abort' | 'apply';
}

export async function POST(req: Request): Promise<Response> {
  const c = getController();
  if (!c) {
    return Response.json(
      { ok: false, error: { message: 'wind-cal run controller not initialised' } },
      { status: 503 },
    );
  }
  let body: PostBody;
  try {
    body = (await req.json()) as PostBody;
  } catch {
    return Response.json({ ok: false, error: { message: 'invalid JSON body' } }, { status: 400 });
  }

  switch (body.action) {
    case 'start':
      return Response.json({ ok: true, status: c.start() });
    case 'stop':
      return Response.json({ ok: true, status: c.stop() });
    case 'abort':
      return Response.json({ ok: true, status: c.abort() });
    case 'apply': {
      const measured = c.result();
      if (!measured || measured.awsBins.length === 0) {
        return Response.json(
          { ok: false, error: { message: 'no run result to apply — stop a run first' } },
          { status: 400 },
        );
      }
      try {
        const store = getSharedConfigStore();
        const merged = mergeMisalignmentCal(store.getWindMisalignmentCal(), measured);
        await store.setWindMisalignmentCal(merged);
        return Response.json({ ok: true, cal: merged, status: c.status() });
      } catch (err) {
        return Response.json(
          { ok: false, error: { message: err instanceof Error ? err.message : String(err) } },
          { status: 503 },
        );
      }
    }
    default:
      return Response.json(
        { ok: false, error: { message: 'action must be start | stop | abort | apply' } },
        { status: 400 },
      );
  }
}

/**
 * Merge a measured run result into the stored cal. The run observed TWD with
 * the existing cal already applied, so the measured offsets are *residuals*:
 * at each measured bin the new offset is the existing cal interpolated there
 * plus the residual. Bins only present in the existing cal keep their values.
 */
function mergeMisalignmentCal(
  existing: WindMisalignmentCal | null,
  measured: WindMisalignmentCal,
): WindMisalignmentCal {
  if (!existing || existing.awsBins.length === 0) {
    return { awsBins: [...measured.awsBins], awaOffsetRad: [...measured.awaOffsetRad] };
  }
  const measuredByBin = new Map<number, number>();
  for (let i = 0; i < measured.awsBins.length; i++) {
    measuredByBin.set(measured.awsBins[i]!, measured.awaOffsetRad[i]!);
  }
  const existingByBin = new Map<number, number>();
  for (let i = 0; i < existing.awsBins.length; i++) {
    existingByBin.set(existing.awsBins[i]!, existing.awaOffsetRad[i]!);
  }
  const awsBins = [...new Set([...existing.awsBins, ...measured.awsBins])].sort((a, b) => a - b);
  const awaOffsetRad = awsBins.map((bin) => {
    const residual = measuredByBin.get(bin);
    if (residual !== undefined) return applyMisalignmentCal(bin, existing) + residual;
    return existingByBin.get(bin)!;
  });
  return { awsBins, awaOffsetRad };
}
