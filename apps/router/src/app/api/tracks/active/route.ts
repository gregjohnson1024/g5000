import { activeTrack } from '../../../../lib/tracks';
import { ensureRecorder } from '../../../../lib/track-recorder';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * GET /api/tracks/active
 *
 * Returns the currently-recording track (`endedAt === null`), full with
 * its point array. Used by /chart to hydrate the trail polyline on page
 * load so reloads don't lose the breadcrumb.
 *
 * Side-effect: ensures the recorder is alive. If the recorder has been
 * idle (e.g. just-restarted dev server), it'll spin up and create the
 * first track within a few seconds — this endpoint returns null until then.
 */
export async function GET(): Promise<Response> {
  ensureRecorder();
  const t = await activeTrack();
  if (!t) return Response.json({ ok: true, track: null });
  return Response.json({ ok: true, track: t });
}
