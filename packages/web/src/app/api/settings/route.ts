import { SETTINGS } from '../../../lib/paths';
import { readJson, writeJson } from '../../../lib/persistence';
import { parseJsonBody } from '../../../lib/req';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(): Promise<Response> {
  const settings = (await readJson(SETTINGS)) ?? {};
  return Response.json({ ok: true, settings });
}

export async function PUT(req: Request): Promise<Response> {
  const parsed = await parseJsonBody<unknown>(req, 'bad_request');
  if (!parsed.ok) return parsed.response;
  const body = parsed.body;
  if (!body || typeof body !== 'object') {
    return Response.json(
      { ok: false, error: { kind: 'bad_request', message: 'body must be an object' } },
      { status: 400 },
    );
  }
  await writeJson(SETTINGS, body);
  return Response.json({ ok: true });
}
