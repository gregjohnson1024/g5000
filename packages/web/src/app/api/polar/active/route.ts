import { getSharedConfigStore } from '@g5000/db';
import type { PolarMode } from '@g5000/db';

interface Body {
  sailConfigId?: string;
  mode?: PolarMode;
  revisionId?: string;
}

export async function POST(req: Request): Promise<Response> {
  const store = getSharedConfigStore();
  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return Response.json({ error: 'invalid json' }, { status: 400 });
  }
  if (
    typeof body.sailConfigId !== 'string' ||
    typeof body.mode !== 'string' ||
    typeof body.revisionId !== 'string'
  ) {
    return Response.json({ error: 'missing required fields' }, { status: 400 });
  }
  try {
    await store.setActiveRevision(body.sailConfigId, body.mode, body.revisionId);
  } catch (err) {
    const msg = (err as Error).message;
    if (msg.includes('not found')) {
      return Response.json({ error: msg }, { status: 404 });
    }
    return Response.json({ error: msg }, { status: 400 });
  }
  return Response.json({ ok: true });
}
