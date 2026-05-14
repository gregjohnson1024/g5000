import { computeDistanceStats } from '../../../../lib/distance-stats';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * GET /api/stats/distance — over-ground distance traveled over rolling
 * windows (1h, 3h, 6h, 12h, 24h) plus a 24h-history sparkline computed
 * from the active track on disk.
 *
 * Everything in metres; clients convert to NM for display (× 1/1852).
 *
 * Use case: fuel planning on a passage. The 24h-history series shows how
 * mileage per day has been trending so the user can extrapolate fuel
 * burn against remaining tank capacity.
 */
export async function GET(): Promise<Response> {
  try {
    const stats = await computeDistanceStats();
    return Response.json({ ok: true, stats });
  } catch (err) {
    return Response.json(
      {
        ok: false,
        error: {
          kind: 'internal',
          message: err instanceof Error ? err.message : String(err),
        },
      },
      { status: 500 },
    );
  }
}
