import { getRoute, updateRoute, deleteRoute } from '../../../../lib/routes';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

interface Ctx {
  params: Promise<{ id: string }>;
}

export async function GET(_req: Request, { params }: Ctx): Promise<Response> {
  const { id } = await params;
  const route = await getRoute(id);
  if (!route) return Response.json({ ok: false, error: { message: 'not found' } }, { status: 404 });
  return Response.json({ ok: true, route });
}

export async function PUT(req: Request, { params }: Ctx): Promise<Response> {
  const { id } = await params;
  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return Response.json({ ok: false, error: { message: 'invalid JSON' } }, { status: 400 });
  }
  const patch: { name?: string; waypointIds?: string[]; notes?: string } = {};
  if (typeof body.name === 'string') patch.name = body.name;
  if (Array.isArray(body.waypointIds) && body.waypointIds.every((x) => typeof x === 'string')) {
    patch.waypointIds = body.waypointIds as string[];
  }
  if (typeof body.notes === 'string') patch.notes = body.notes;
  try {
    const route = await updateRoute(id, patch);
    if (!route)
      return Response.json({ ok: false, error: { message: 'not found' } }, { status: 404 });
    return Response.json({ ok: true, route });
  } catch (e) {
    return Response.json(
      { ok: false, error: { message: e instanceof Error ? e.message : 'update failed' } },
      { status: 400 },
    );
  }
}

export async function DELETE(_req: Request, { params }: Ctx): Promise<Response> {
  const { id } = await params;
  const ok = await deleteRoute(id);
  if (!ok) return Response.json({ ok: false, error: { message: 'not found' } }, { status: 404 });
  return Response.json({ ok: true });
}
