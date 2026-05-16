import { getSharedMotionStats } from '@g5000/core';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * GET /api/stats/motion — RMS deviation of pitch and heel from their
 * rolling-window means, plus a combined sqrt(heel² + pitch²) summary.
 * Higher number = bouncier ride.
 */
export async function GET(): Promise<Response> {
  const s = getSharedMotionStats();
  if (!s) {
    return Response.json(
      { ok: false, error: { kind: 'unavailable', message: 'motion stats not online' } },
      { status: 503 },
    );
  }
  return Response.json({ ok: true, stats: s.snapshot() });
}
