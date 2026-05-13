import {
  listWaypoints,
  createWaypoint,
  type Waypoint,
} from '../../../lib/waypoints';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(): Promise<Response> {
  const list = await listWaypoints();
  return Response.json({ ok: true, waypoints: list });
}

interface CreateBody {
  name?: unknown;
  lat?: unknown;
  lon?: unknown;
  notes?: unknown;
  id?: unknown;
}

export async function POST(req: Request): Promise<Response> {
  let body: CreateBody;
  try {
    body = (await req.json()) as CreateBody;
  } catch {
    return Response.json({ ok: false, error: { message: 'invalid JSON' } }, { status: 400 });
  }
  if (typeof body.name !== 'string' || body.name.trim().length === 0) {
    return Response.json({ ok: false, error: { message: 'name required' } }, { status: 422 });
  }
  if (typeof body.lat !== 'number' || !Number.isFinite(body.lat) || Math.abs(body.lat) > 90) {
    return Response.json({ ok: false, error: { message: 'lat must be a number in [-90,90]' } }, { status: 422 });
  }
  if (typeof body.lon !== 'number' || !Number.isFinite(body.lon) || Math.abs(body.lon) > 180) {
    return Response.json({ ok: false, error: { message: 'lon must be a number in [-180,180]' } }, { status: 422 });
  }
  try {
    const created: Waypoint = await createWaypoint({
      name: body.name.trim(),
      lat: body.lat,
      lon: body.lon,
      notes: typeof body.notes === 'string' ? body.notes : undefined,
      id: typeof body.id === 'string' && body.id.trim().length > 0 ? body.id.trim() : undefined,
    });
    return Response.json({ ok: true, waypoint: created }, { status: 201 });
  } catch (e) {
    return Response.json(
      { ok: false, error: { message: e instanceof Error ? e.message : String(e) } },
      { status: 409 },
    );
  }
}
