import { getGulfStreamNorthWall } from '../../../../lib/gulf-stream';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * GET /api/gulf-stream/north-wall — returns the latest Gulf Stream
 * North Wall contour as a GeoJSON FeatureCollection. Cached under
 * ~/.g5000-router/gulf-stream/north-wall.json with a 6 h refresh
 * window. NOAA updates the source once per day.
 */
export async function GET(): Promise<Response> {
  try {
    const payload = await getGulfStreamNorthWall();
    return Response.json({ ok: true, ...payload });
  } catch (err) {
    return Response.json(
      {
        ok: false,
        error: {
          kind: 'unavailable',
          message: err instanceof Error ? err.message : String(err),
        },
      },
      { status: 502 },
    );
  }
}
