import { fetchActivePolar } from '../../../../lib/g5000-client';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(): Promise<Response> {
  const polar = await fetchActivePolar();
  if (!polar) {
    return Response.json({ ok: false, error: { kind: 'unavailable' } }, { status: 503 });
  }
  return Response.json({ ok: true, polar });
}
