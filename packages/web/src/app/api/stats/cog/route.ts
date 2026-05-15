import { getSharedCogStats } from '@g5000/core';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * GET /api/stats/cog — server-side circular-mean of COG over a rolling
 * window. Same shape and window as /api/stats/sog. Returns `avgRad`
 * (radians, [0, 2π)) plus `concentration` ∈ [0,1] indicating how
 * meaningful the average is (low concentration = boat has been changing
 * direction — average is statistically weak).
 */
export async function GET(): Promise<Response> {
  const s = getSharedCogStats();
  if (!s) {
    return Response.json(
      { ok: false, error: { kind: 'unavailable', message: 'cog stats not online' } },
      { status: 503 },
    );
  }
  return Response.json({ ok: true, stats: s.snapshot() });
}
