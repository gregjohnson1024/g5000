import { getTrack, updateTrack, deleteTrack } from '../../../../lib/tracks';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

interface Ctx {
  params: Promise<{ id: string }>;
}

export async function GET(_req: Request, { params }: Ctx): Promise<Response> {
  const { id } = await params;
  const t = await getTrack(id);
  if (!t) return Response.json({ ok: false, error: { message: 'not found' } }, { status: 404 });
  return Response.json({ ok: true, track: t });
}

export async function PUT(req: Request, { params }: Ctx): Promise<Response> {
  const { id } = await params;
  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return Response.json({ ok: false, error: { message: 'invalid JSON' } }, { status: 400 });
  }
  const patch: { label?: string } = {};
  if (typeof body.label === 'string') patch.label = body.label;
  const t = await updateTrack(id, patch);
  if (!t) return Response.json({ ok: false, error: { message: 'not found' } }, { status: 404 });
  return Response.json({ ok: true, track: t });
}

export async function DELETE(_req: Request, { params }: Ctx): Promise<Response> {
  const { id } = await params;
  const ok = await deleteTrack(id);
  if (!ok) return Response.json({ ok: false, error: { message: 'not found' } }, { status: 404 });
  return Response.json({ ok: true });
}
