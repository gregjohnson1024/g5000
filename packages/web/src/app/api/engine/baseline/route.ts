import {
  computeEngineHours,
  readEngineLog,
  setEngineBaseline,
} from '../../../../lib/engine-log';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * GET — current baseline (lifetime engine-meter readings).
 * PUT — update one or both. Body: { port?: number, stbd?: number }.
 *
 * Baseline is added to the g5000-tracked running hours to produce the
 * "lifetime hours" totals shown in the UI.
 */
export async function GET(): Promise<Response> {
  const file = await readEngineLog();
  return Response.json({ ok: true, baseline: file.baseline });
}

interface PutBody {
  port?: number;
  stbd?: number;
}

export async function PUT(req: Request): Promise<Response> {
  let body: PutBody;
  try {
    body = (await req.json()) as PutBody;
  } catch {
    return Response.json(
      { ok: false, error: { kind: 'bad_request', message: 'invalid JSON' } },
      { status: 400 },
    );
  }
  const file = await setEngineBaseline(body);
  const summary = computeEngineHours(file);
  return Response.json({ ok: true, baseline: file.baseline, summary });
}
