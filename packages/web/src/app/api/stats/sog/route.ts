import { getSharedSogStats } from '@g5000/core';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * GET /api/stats/sog — server-side rolling-window SOG mean.
 *
 * Computed by `startSogStats` in apps/autopilot-server, which subscribes to
 * `nav.gps.sog` from the bus and maintains a 15-min ring of samples.
 * Returns the snapshot in m/s — clients convert to knots for display.
 *
 * Why this exists: the helm tile used to keep a React-ref buffer per page
 * mount, which reset every time the user switched tabs. Server-side
 * persistence means the average actually represents the boat's recent
 * speed, not just "speed since this tab opened".
 */
export async function GET(): Promise<Response> {
  const s = getSharedSogStats();
  if (!s) {
    return Response.json(
      { ok: false, error: { kind: 'unavailable', message: 'sog stats not online' } },
      { status: 503 },
    );
  }
  return Response.json({ ok: true, stats: s.snapshot() });
}
