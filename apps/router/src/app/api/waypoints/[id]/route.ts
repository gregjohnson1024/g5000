import { getWaypoint, updateWaypoint, deleteWaypoint } from '../../../../lib/waypoints';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

interface Ctx {
  params: Promise<{ id: string }>;
}

export async function GET(_req: Request, { params }: Ctx): Promise<Response> {
  const { id } = await params;
  const wp = await getWaypoint(id);
  if (!wp) return Response.json({ ok: false, error: { message: 'not found' } }, { status: 404 });
  return Response.json({ ok: true, waypoint: wp });
}

export async function PUT(req: Request, { params }: Ctx): Promise<Response> {
  const { id } = await params;
  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return Response.json({ ok: false, error: { message: 'invalid JSON' } }, { status: 400 });
  }
  const patch: Record<string, unknown> = {};
  if (typeof body.name === 'string' && body.name.trim().length > 0) patch.name = body.name.trim();
  if (typeof body.lat === 'number' && Number.isFinite(body.lat) && Math.abs(body.lat) <= 90)
    patch.lat = body.lat;
  if (typeof body.lon === 'number' && Number.isFinite(body.lon) && Math.abs(body.lon) <= 180)
    patch.lon = body.lon;
  if (typeof body.notes === 'string') patch.notes = body.notes;
  const updated = await updateWaypoint(id, patch);
  if (!updated) return Response.json({ ok: false, error: { message: 'not found' } }, { status: 404 });
  return Response.json({ ok: true, waypoint: updated });
}

export async function DELETE(_req: Request, { params }: Ctx): Promise<Response> {
  const { id } = await params;
  const ok = await deleteWaypoint(id);
  if (!ok) return Response.json({ ok: false, error: { message: 'not found' } }, { status: 404 });
  return Response.json({ ok: true });
}
