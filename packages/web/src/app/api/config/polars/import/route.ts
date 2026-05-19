import { firstValueFrom } from 'rxjs';
import { ulid } from 'ulid';
import { getSharedConfigStore, type PolarRevision } from '@g5000/db';
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
  const wardrobe = await firstValueFrom(store.sails$);
  const rev: PolarRevision = {
    id: ulid(),
    boatId: wardrobe.boatId,
    sailConfigId: wardrobe.activeMode,
    mode: wardrobe.activeMode,
    parentRevisionId: null,
    createdAt: Math.floor(Date.now() / 1000),
    lineage: { kind: 'imported_csv' },
    table: polar,
  };
  await store.createRevision(rev);
  return Response.json({
    ok: true,
    revisionId: rev.id,
    twsBinCount: polar.twsBins.length,
    twaBinCount: polar.twaBins.length,
  });
}
