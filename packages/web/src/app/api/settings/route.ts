import { SETTINGS } from '../../../lib/paths';
import { readJson, writeJson } from '../../../lib/persistence';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(): Promise<Response> {
  const settings = (await readJson(SETTINGS)) ?? {};
  return Response.json({ ok: true, settings });
}

export async function PUT(req: Request): Promise<Response> {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return Response.json(
      { ok: false, error: { kind: 'bad_request', message: 'invalid JSON' } },
      { status: 400 },
    );
  }
  if (!body || typeof body !== 'object') {
    return Response.json(
      { ok: false, error: { kind: 'bad_request', message: 'body must be an object' } },
      { status: 400 },
    );
  }
  await writeJson(SETTINGS, body);
  return Response.json({ ok: true });
}
