import { interruptActive } from '../../../../lib/tracks';
import { ensureRecorder, notifyTrackChange } from '../../../../lib/track-recorder';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * POST /api/tracks/interrupt
 *
 * Closes the currently-active track (sets endedAt to now) and starts a
 * fresh one. The new track inherits any `label` passed in the body.
 */
export async function POST(req: Request): Promise<Response> {
  let body: { label?: unknown } = {};
  try {
    body = (await req.json()) as { label?: unknown };
  } catch {
    /* no body — that's fine */
  }
  ensureRecorder();
  const label = typeof body.label === 'string' ? body.label.trim() : '';
  const fresh = await interruptActive(label);
  notifyTrackChange();
  return Response.json({ ok: true, track: fresh });
}
