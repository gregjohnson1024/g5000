import { getSharedHdgStats } from '@g5000/core';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * GET /api/stats/hdg — server-side circular-mean of boat heading over a
 * rolling window. Same shape as /api/stats/cog. The avg-COG vs avg-HDG
 * delta approximates the current's set angle in calm wind.
 */
export async function GET(): Promise<Response> {
  const s = getSharedHdgStats();
  if (!s) {
    return Response.json(
      { ok: false, error: { kind: 'unavailable', message: 'hdg stats not online' } },
      { status: 503 },
    );
  }
  return Response.json({ ok: true, stats: s.snapshot() });
}
