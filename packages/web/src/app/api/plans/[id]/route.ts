import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import { PLANS_DIR } from '../../../../lib/paths';
import { readJson } from '../../../../lib/persistence';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

function validateId(id: string): boolean {
  return /^[a-zA-Z0-9-]+$/.test(id);
}

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id } = await params;
  if (!validateId(id)) {
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

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id } = await params;
  if (!validateId(id)) {
    return Response.json(
      { ok: false, error: { kind: 'bad_request', message: 'invalid id' } },
      { status: 400 },
    );
  }
  try {
    await fs.unlink(join(PLANS_DIR, `${id}.json`));
    return Response.json({ ok: true });
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      return Response.json(
        { ok: false, error: { kind: 'not_found' } },
        { status: 404 },
      );
    }
    return Response.json(
      {
        ok: false,
        error: { kind: 'internal', message: err instanceof Error ? err.message : String(err) },
      },
      { status: 500 },
    );
  }
}
