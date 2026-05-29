import { getTrack, updateTrack, deleteTrack } from '../../../../lib/tracks';
import { parseJsonBody } from '../../../../lib/req';

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
  const parsed = await parseJsonBody<Record<string, unknown>>(req);
  if (!parsed.ok) return parsed.response;
  const body = parsed.body;
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
