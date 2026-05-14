import { getSharedAlerts } from '@g5000/core';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

interface Body {
  key: string;
  command?: 'Acknowledge' | 'Temporary Silence' | 'Test Command Off' | 'Test Command On';
}

/**
 * POST /api/alerts/acknowledge — sends PGN 126984 Alert Response to the
 * issuer of the alert identified by `key`. Default command is
 * `Acknowledge`. The issuer is expected to respond by re-emitting 126983
 * with an updated Acknowledge Status, which flows back through the
 * decoder into the registry — we don't optimistically clear state here.
 *
 * Returns `{ ok, error?, retryable? }`. If the bridge has no transmitter
 * registered (no live N2K driver online), the response is
 * `{ ok: false, error: 'no alert transmitter registered ...' }`.
 */
export async function POST(req: Request): Promise<Response> {
  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return Response.json({ ok: false, error: { kind: 'bad_request', message: 'invalid JSON' } }, { status: 400 });
  }
  if (!body || typeof body.key !== 'string' || !body.key) {
    return Response.json(
      { ok: false, error: { kind: 'bad_request', message: 'missing key' } },
      { status: 400 },
    );
  }
  const registry = getSharedAlerts();
  if (!registry || !registry.acknowledge) {
    return Response.json(
      { ok: false, error: { kind: 'unavailable', message: 'alerts registry not online' } },
      { status: 503 },
    );
  }
  const command = body.command ?? 'Acknowledge';
  const r = await registry.acknowledge({ key: body.key, command });
  if (r.ok) return Response.json({ ok: true });
  return Response.json(
    { ok: false, error: { kind: 'internal', message: r.error ?? 'failed' } },
    { status: 502 },
  );
}
