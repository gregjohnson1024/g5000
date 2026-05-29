import { listRoutes, createRoute } from '../../../lib/routes';
import { parseJsonBody } from '../../../lib/req';

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
  const parsed = await parseJsonBody<CreateBody>(req);
  if (!parsed.ok) return parsed.response;
  const body = parsed.body;
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
      name: body.name.trim(),
      waypointIds: body.waypointIds as string[],
      notes: typeof body.notes === 'string' ? body.notes : undefined,
      id: typeof body.id === 'string' ? body.id : undefined,
    });
    return Response.json({ ok: true, route }, { status: 201 });
  } catch (e) {
    return Response.json(
      { ok: false, error: { message: e instanceof Error ? e.message : String(e) } },
      { status: 400 },
    );
  }
}
