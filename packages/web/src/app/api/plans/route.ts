import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { PLANS_DIR } from '../../../lib/paths';
import { writeJson, readJson, listJson } from '../../../lib/persistence';
import { parseJsonBody } from '../../../lib/req';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(): Promise<Response> {
  const names = await listJson(PLANS_DIR);
  const items = await Promise.all(names.map(async (n) => readJson(join(PLANS_DIR, n))));
  return Response.json({ ok: true, items: items.filter(Boolean) });
}

export async function POST(req: Request): Promise<Response> {
  const parsed = await parseJsonBody<unknown>(req, 'bad_request');
  if (!parsed.ok) return parsed.response;
  const body = parsed.body;
  if (!body || typeof body !== 'object') {
    return Response.json(
      { ok: false, error: { kind: 'bad_request', message: 'body must be an object' } },
      { status: 400 },
    );
  }
  const o = body as { name?: unknown; route?: unknown; createdAt?: unknown };
  if (typeof o.name !== 'string' || !o.name.trim()) {
    return Response.json(
      { ok: false, error: { kind: 'bad_request', message: 'name is required' } },
      { status: 400 },
    );
  }
  if (!o.route || typeof o.route !== 'object') {
    return Response.json(
      { ok: false, error: { kind: 'bad_request', message: 'route is required' } },
      { status: 400 },
    );
  }
  const id = randomUUID();
  const record = {
    id,
    name: o.name,
    route: o.route,
    createdAt: typeof o.createdAt === 'number' ? o.createdAt : Math.floor(Date.now() / 1000),
  };
  await writeJson(join(PLANS_DIR, `${id}.json`), record);
  return Response.json({ ok: true, id });
}
