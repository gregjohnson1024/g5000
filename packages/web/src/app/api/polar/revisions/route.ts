import { ulid } from 'ulid';
import { getSharedConfigStore } from '@g5000/db';
import type { PolarLineage, PolarMode, PolarRevision, PolarTable } from '@g5000/db';

export async function GET(req: Request): Promise<Response> {
  const store = getSharedConfigStore();
  const url = new URL(req.url);
  const sailConfigId = url.searchParams.get('sailConfigId') ?? undefined;
  const mode = (url.searchParams.get('mode') as PolarMode | null) ?? undefined;
  const boatId = url.searchParams.get('boatId') ?? undefined;
  const revisions = store.listRevisions({ boatId, sailConfigId, mode });
  return Response.json({ revisions });
}

interface PostBody {
  sailConfigId?: string;
  mode?: PolarMode;
  parentRevisionId?: string | null;
  lineage?: PolarLineage;
  sigma?: number;
  table?: PolarTable;
}

export async function POST(req: Request): Promise<Response> {
  const store = getSharedConfigStore();
  let body: PostBody;
  try {
    body = (await req.json()) as PostBody;
  } catch {
    return Response.json({ error: 'invalid json' }, { status: 400 });
  }

  if (
    typeof body.sailConfigId !== 'string' ||
    typeof body.mode !== 'string' ||
    !body.lineage ||
    typeof body.lineage.kind !== 'string' ||
    !body.table
  ) {
    return Response.json({ error: 'missing required fields' }, { status: 400 });
  }

  const rev: PolarRevision = {
    id: ulid().toLowerCase(),
    boatId: store.activeBoatId, // active boat — ConfigStore filters/reads on the active boat
    sailConfigId: body.sailConfigId,
    mode: body.mode,
    parentRevisionId: body.parentRevisionId ?? null,
    createdAt: Math.floor(Date.now() / 1000),
    lineage: body.lineage,
    ...(body.sigma !== undefined ? { sigma: body.sigma } : {}),
    table: body.table,
  };

  try {
    await store.createRevision(rev);
  } catch (err) {
    return Response.json(
      { error: (err as Error).message ?? 'create failed' },
      { status: 400 },
    );
  }
  return Response.json({ id: rev.id }, { status: 201 });
}
