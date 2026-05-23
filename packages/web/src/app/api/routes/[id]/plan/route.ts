import { getRoute } from '../../../../../lib/routes';
import { getWaypoint } from '../../../../../lib/waypoints';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

interface Ctx {
  params: Promise<{ id: string }>;
}

export async function POST(req: Request, { params }: Ctx): Promise<Response> {
  const { id } = await params;
  const route = await getRoute(id);
  if (!route) {
    return Response.json({ ok: false, error: { message: 'route not found' } }, { status: 404 });
  }
  if (route.waypointIds.length < 2) {
    return Response.json(
      { ok: false, error: { message: 'route needs at least 2 waypoints to plan' } },
      { status: 400 },
    );
  }
  const firstWp = await getWaypoint(route.waypointIds[0]!);
  const lastWp = await getWaypoint(route.waypointIds[route.waypointIds.length - 1]!);
  if (!firstWp || !lastWp) {
    return Response.json(
      { ok: false, error: { message: 'route references a missing waypoint' } },
      { status: 409 },
    );
  }

  let opts: {
    model?: 'GFS' | 'ECMWF';
    departure?: number;
    useCurrents?: boolean;
    options?: Record<string, unknown>;
  } = {};
  try {
    opts = (await req.json()) as typeof opts;
  } catch {
    /* empty body is fine */
  }

  // Pre-flight: verify an active polar exists before forwarding to the router.
  // /api/wardrobe/active returns { id, polar, activeMode } on success (no `ok`
  // field) or { error } with a non-2xx status on failure.
  const origin = new URL(req.url).origin;
  const wRes = await fetch(`${origin}/api/wardrobe/active`, { cache: 'no-store' });
  if (!wRes.ok) {
    return Response.json({ ok: false, error: { message: 'no active polar' } }, { status: 409 });
  }
  const wJson = (await wRes.json()) as { id?: string; polar?: unknown; activeMode?: string };
  if (!wJson.polar) {
    return Response.json({ ok: false, error: { message: 'no active polar' } }, { status: 409 });
  }

  // /api/route/plan fetches the polar internally from ConfigStore — it does
  // not accept polarId/polar in the request body. Forward only the fields it
  // actually validates: start, end, departure, model, useCurrents, options.
  const planReq = {
    start: { lat: firstWp.lat, lon: firstWp.lon },
    end: { lat: lastWp.lat, lon: lastWp.lon },
    departure: opts.departure ?? Math.floor(Date.now() / 1000),
    model: opts.model ?? 'GFS',
    useCurrents: opts.useCurrents ?? false,
    options: opts.options,
  };

  const planRes = await fetch(`${origin}/api/route/plan`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(planReq),
  });
  const planJson = (await planRes.json()) as unknown;
  return Response.json(planJson, { status: planRes.status });
}
