import { listWaypoints } from '../../../../lib/waypoints';
import { waypointsToGpx } from '../../../../lib/gpx-export';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/** GET /api/waypoints/export-gpx — all saved waypoints as a GPX 1.1 file. */
export async function GET(): Promise<Response> {
  const gpx = waypointsToGpx(await listWaypoints());
  return new Response(gpx, {
    headers: {
      'Content-Type': 'application/gpx+xml; charset=utf-8',
      'Content-Disposition': 'attachment; filename="waypoints.gpx"',
    },
  });
}
