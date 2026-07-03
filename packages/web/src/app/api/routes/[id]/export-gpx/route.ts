import { getRoute } from '../../../../../lib/routes';
import { listWaypoints } from '../../../../../lib/waypoints';
import { savedRouteToGpx } from '../../../../../lib/gpx-export';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

interface Ctx {
  params: Promise<{ id: string }>;
}

/** GET /api/routes/[id]/export-gpx — one saved route as a GPX 1.1 <rte> file. */
export async function GET(_req: Request, { params }: Ctx): Promise<Response> {
  const { id } = await params;
  const route = await getRoute(id);
  if (!route) return Response.json({ ok: false, error: { message: 'not found' } }, { status: 404 });
  try {
    const gpx = savedRouteToGpx(route, await listWaypoints());
    return new Response(gpx, {
      headers: {
        'Content-Type': 'application/gpx+xml; charset=utf-8',
        'Content-Disposition': `attachment; filename="${route.id}.gpx"`,
      },
    });
  } catch (e) {
    return Response.json(
      { ok: false, error: { message: e instanceof Error ? e.message : String(e) } },
      { status: 500 },
    );
  }
}
