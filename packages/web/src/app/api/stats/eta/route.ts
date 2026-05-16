import { computeEta } from '../../../../lib/eta-stats';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

// Hardcoded passage destination — Nantucket Harbor (Brant Point Light area),
// north side of Nantucket Island MA. 41°17.4'N 70°05.4'W. User pivoted
// destination Bristol Marine → Madaket → Nantucket Harbor across the passage.
const DESTINATION = {
  lat: 41.29,
  lon: -70.09,
  label: 'Nantucket',
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
