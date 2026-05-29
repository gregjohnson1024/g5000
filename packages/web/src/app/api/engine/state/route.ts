import {
  appendEngineEntry,
  computeEngineHours,
  readEngineLog,
  type EngineEntry,
} from '../../../../lib/engine-log';
import { parseJsonBody } from '../../../../lib/req';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * GET — current engine state + tracked + total hours.
 * POST — append a new state entry. Body shape:
 *   { t?: number,            // UNIX seconds; defaults to "now"
 *     port: { on: boolean, rpm?: number },
 *     stbd: { on: boolean, rpm?: number },
 *     note?: string }
 *
 * Each entry represents the engine state from `t` onward (until the
 * next entry overrides it). Backdating is allowed — the file is kept
 * sorted by `t` on every write.
 */
export async function GET(): Promise<Response> {
  const file = await readEngineLog();
  const summary = computeEngineHours(file);
  return Response.json({
    ok: true,
    baseline: file.baseline,
    summary,
    entries: file.entries,
  });
}

interface PostBody {
  t?: number;
  port?: { on?: boolean; rpm?: number };
  stbd?: { on?: boolean; rpm?: number };
  note?: string;
}

export async function POST(req: Request): Promise<Response> {
  const parsed = await parseJsonBody<PostBody>(req, 'bad_request');
  if (!parsed.ok) return parsed.response;
  const body = parsed.body;
  const t = typeof body.t === 'number' && Number.isFinite(body.t) ? body.t : Date.now() / 1000;
  if (!body.port || !body.stbd) {
    return Response.json(
      { ok: false, error: { kind: 'bad_request', message: 'port and stbd required' } },
      { status: 400 },
    );
  }
  const entry: EngineEntry = {
    t,
    port: {
      on: !!body.port.on,
      ...(typeof body.port.rpm === 'number' && Number.isFinite(body.port.rpm)
        ? { rpm: body.port.rpm }
        : {}),
    },
    stbd: {
      on: !!body.stbd.on,
      ...(typeof body.stbd.rpm === 'number' && Number.isFinite(body.stbd.rpm)
        ? { rpm: body.stbd.rpm }
        : {}),
    },
    ...(typeof body.note === 'string' && body.note.trim() ? { note: body.note.trim() } : {}),
  };
  const file = await appendEngineEntry(entry);
  const summary = computeEngineHours(file);
  return Response.json({ ok: true, summary, entries: file.entries });
}
