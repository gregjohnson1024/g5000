import { firstValueFrom } from 'rxjs';
import { getSharedConfigStore, type PolarTable } from '@g5000/db';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(): Promise<Response> {
  const store = getSharedConfigStore();
  const polar = await firstValueFrom(store.polars$);
  return Response.json(polar);
}

export async function PUT(req: Request): Promise<Response> {
  const store = getSharedConfigStore();
  let body: PolarTable;
  try {
    body = (await req.json()) as PolarTable;
  } catch {
    return Response.json({ error: 'invalid JSON' }, { status: 400 });
  }
  if (!validatePolar(body)) {
    return Response.json(
      { error: 'invalid polar table shape' },
      { status: 422 },
    );
  }
  await store.setPolars(body);
  return Response.json({ ok: true });
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
