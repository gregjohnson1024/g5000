import { join } from 'node:path';
import { PLANS_DIR } from '../../../../lib/paths';
import { readJson } from '../../../../lib/persistence';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id } = await params;
  if (!/^[a-zA-Z0-9-]+$/.test(id)) {
    return Response.json(
      { ok: false, error: { kind: 'bad_request', message: 'invalid id' } },
      { status: 400 },
    );
  }
  const record = await readJson(join(PLANS_DIR, `${id}.json`));
  if (!record) {
    return Response.json(
      { ok: false, error: { kind: 'not_found' } },
      { status: 404 },
    );
  }
  return Response.json({ ok: true, plan: record });
}
