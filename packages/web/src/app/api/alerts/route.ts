import { getSharedAlerts } from '@g5000/core';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * GET /api/alerts
 *
 * Lists every alert currently tracked by the shared registry. The bridge
 * populates this from PGN 126983 / 126985 as they decode. CPA/TCPA-style
 * derived alerts (g5000-side, not from the bus) aren't in here yet —
 * future work, same registry.
 */
export async function GET(): Promise<Response> {
  const registry = getSharedAlerts();
  const alerts = registry?.all() ?? [];
  return Response.json({ alerts });
}
