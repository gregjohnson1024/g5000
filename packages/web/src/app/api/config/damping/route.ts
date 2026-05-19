import { firstValueFrom } from 'rxjs';
import { getSharedConfigStore, type DampingConfig } from '@g5000/db';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * GET → current damping config (Record<channelName, dampingSeconds>).
 * Missing channels are not damped; values are seconds, > 0.
 */
export async function GET(): Promise<Response> {
  const store = getSharedConfigStore();
  const cfg = await firstValueFrom(store.dampingConfig$);
  return Response.json(cfg);
}

/**
 * PUT replaces the whole damping config.
 *
 * Body: { [channelName: string]: number }
 *   - Values must be finite, non-negative.
 *   - 0 / negative / NaN entries are stripped server-side (see setDampingConfig).
 */
export async function PUT(req: Request): Promise<Response> {
  const store = getSharedConfigStore();
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: 'invalid JSON' }, { status: 400 });
  }
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return Response.json({ error: 'expected JSON object' }, { status: 422 });
  }
  const cfg: DampingConfig = {};
  for (const [k, v] of Object.entries(body as Record<string, unknown>)) {
    if (typeof v !== 'number' || !Number.isFinite(v)) {
      return Response.json({ error: `value for "${k}" is not a finite number` }, { status: 422 });
    }
    cfg[k] = v;
  }
  await store.setDampingConfig(cfg);
  return Response.json({ ok: true });
}
