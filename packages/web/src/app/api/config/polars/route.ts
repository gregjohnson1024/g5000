import { firstValueFrom } from 'rxjs';
import { ulid } from 'ulid';
import { getSharedConfigStore, type PolarTable, type PolarRevision } from '@g5000/db';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(): Promise<Response> {
  const store = getSharedConfigStore();
  const polar = await firstValueFrom(store.activePolar$);
  return Response.json(polar);
}

/**
 * PUT a new polar table. In v3 this writes a new PolarRevision for the
 * boat's active mode, becoming the newest (and therefore "active") polar.
 * The old polar revisions remain in history.
 */
export async function PUT(req: Request): Promise<Response> {
  const store = getSharedConfigStore();
  let body: PolarTable;
  try {
    body = (await req.json()) as PolarTable;
  } catch {
    return Response.json({ error: 'invalid JSON' }, { status: 400 });
  }
  if (!validatePolar(body)) {
    return Response.json({ error: 'invalid polar table shape' }, { status: 422 });
  }
  const wardrobe = await firstValueFrom(store.sails$);
  const rev: PolarRevision = {
    id: ulid(),
    boatId: wardrobe.boatId,
    // v3 has no per-config polar slots; sailConfigId is a legacy column we
    // populate with the active mode so the revisions table remains queryable.
    sailConfigId: wardrobe.activeMode,
    mode: wardrobe.activeMode,
    parentRevisionId: null,
    createdAt: Math.floor(Date.now() / 1000),
    lineage: { kind: 'manual_edit' },
    table: body,
  };
  await store.createRevision(rev);
  return Response.json({ ok: true, revisionId: rev.id });
}

function validatePolar(p: unknown): p is PolarTable {
  if (!p || typeof p !== 'object') return false;
  const o = p as Record<string, unknown>;
  if (!Array.isArray(o.twsBins) || !Array.isArray(o.twaBins) || !Array.isArray(o.boatSpeed)) {
    return false;
  }
  if ((o.boatSpeed as unknown[]).length !== o.twsBins.length) return false;
  for (const row of o.boatSpeed as unknown[]) {
    if (!Array.isArray(row) || row.length !== o.twaBins.length) return false;
  }
  return true;
}
