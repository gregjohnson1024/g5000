import { getSharedConfigStore } from '@g5000/db';
import { parseExpeditionPolar } from '@g5000/compute';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function POST(req: Request): Promise<Response> {
  const store = getSharedConfigStore();
  const csv = await req.text();
  if (!csv || csv.length === 0) {
    return Response.json({ error: 'empty body' }, { status: 400 });
  }
  let polar;
  try {
    polar = parseExpeditionPolar(csv);
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : String(e) }, { status: 422 });
  }
  await store.setPolars(polar);
  return Response.json({
    ok: true,
    twsBinCount: polar.twsBins.length,
    twaBinCount: polar.twaBins.length,
  });
}
