import { computeEta } from '../../../../lib/eta-stats';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

// Hardcoded passage destination — Bristol Marine, Bristol RI.
// From destination-and-waypoints memory: 41°45'53.9"N 71°07'42.6"W.
const BRISTOL_MARINE = {
  lat: 41.76497,
  lon: -71.12850,
  label: 'Bristol Marine',
};

/**
 * GET /api/stats/eta — ETA to the passage destination using the average
 * speed over the last 3 hours (distance traveled / 3 h, from the active
 * track on disk). Returns 503 if there is no active track.
 */
export async function GET(): Promise<Response> {
  const eta = await computeEta(
    BRISTOL_MARINE.lat,
    BRISTOL_MARINE.lon,
    BRISTOL_MARINE.label,
  );
  if (!eta) {
    return Response.json(
      { ok: false, error: { kind: 'no_track', message: 'no active track with points' } },
      { status: 503 },
    );
  }
  return Response.json({ ok: true, eta });
}
