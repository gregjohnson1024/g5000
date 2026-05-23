import { listRoutes, createRoute } from '../../../lib/routes';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(): Promise<Response> {
  return Response.json({ ok: true, routes: await listRoutes() });
}

interface CreateBody {
  name?: unknown;
  waypointIds?: unknown;
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
  if (typeof body.name !== 'string' || body.name.trim() === '') {
    return Response.json({ ok: false, error: { message: 'name is required' } }, { status: 422 });
  }
  if (!Array.isArray(body.waypointIds) || !body.waypointIds.every((x) => typeof x === 'string')) {
    return Response.json(
      { ok: false, error: { message: 'waypointIds must be string[]' } },
      { status: 422 },
    );
  }
  try {
    const route = await createRoute({
      name: body.name,
      waypointIds: body.waypointIds as string[],
      notes: typeof body.notes === 'string' ? body.notes : undefined,
      id: typeof body.id === 'string' ? body.id : undefined,
    });
    return Response.json({ ok: true, route }, { status: 201 });
  } catch (e) {
    return Response.json(
      { ok: false, error: { message: e instanceof Error ? e.message : 'create failed' } },
      { status: 400 },
    );
  }
}
