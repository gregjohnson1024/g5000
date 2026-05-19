import { computeEta } from '../../../../lib/eta-stats';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

// Hardcoded passage destination — Newport Shipyard, RI. 41°29.2'N 71°19.5'W.
// User pivoted destination Bristol → Madaket → Nantucket → Newport across the
// passage; Block Island is the planned fuel-stop option (see BlockIslandTile
// on /passage for the diversion math).
const DESTINATION = {
  lat: 41.4869,
  lon: -71.3258,
  label: 'Newport',
};

/**
 * GET /api/stats/eta — ETA to the passage destination using the average
 * speed over the last 3 hours (distance traveled / 3 h, from the active
 * track on disk). Returns 503 if there is no active track.
 */
export async function GET(): Promise<Response> {
  const eta = await computeEta(DESTINATION.lat, DESTINATION.lon, DESTINATION.label);
  if (!eta) {
    return Response.json(
      { ok: false, error: { kind: 'no_track', message: 'no active track with points' } },
      { status: 503 },
    );
  }
  return Response.json({ ok: true, eta });
}
