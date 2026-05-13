import { listTracks } from '../../../lib/tracks';
import { ensureRecorder, recorderStatus } from '../../../lib/track-recorder';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(): Promise<Response> {
  // Side-effect: make sure the background recorder is alive.
  ensureRecorder();
  const tracks = await listTracks();
  return Response.json({ ok: true, tracks, recorder: recorderStatus() });
}
