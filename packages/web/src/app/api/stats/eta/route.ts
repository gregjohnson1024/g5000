import { computeEta } from '../../../../lib/eta-stats';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

// Hardcoded passage destination — Madaket Harbor, western Nantucket MA.
// 41°16.32'N 70°12.30'W. User pivoted destination from Bristol Marine
// to Madaket mid-passage 2026-05-16.
const DESTINATION = {
  lat: 41.272,
  lon: -70.205,
  label: 'Madaket',
};

/**
 * GET /api/stats/eta — ETA to the passage destination using the average
 * speed over the last 3 hours (distance traveled / 3 h, from the active
 * track on disk). Returns 503 if there is no active track.
 */
export async function GET(): Promise<Response> {
  const eta = await computeEta(
    DESTINATION.lat,
    DESTINATION.lon,
    DESTINATION.label,
  );
  if (!eta) {
    return Response.json(
      { ok: false, error: { kind: 'no_track', message: 'no active track with points' } },
      { status: 503 },
    );
  }
  return Response.json({ ok: true, eta });
}
