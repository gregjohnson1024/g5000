import { firstValueFrom } from 'rxjs';
import { getSharedConfigStore, type BoatConfig } from '@g5000/db';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(): Promise<Response> {
  const store = getSharedConfigStore();
  const cfg = await firstValueFrom(store.boatConfig$);
  return Response.json(cfg);
}

export async function PUT(req: Request): Promise<Response> {
  const store = getSharedConfigStore();
  let body: BoatConfig;
  try {
    body = (await req.json()) as BoatConfig;
  } catch {
    return Response.json({ error: 'invalid JSON' }, { status: 400 });
  }
  if (!validate(body)) {
    return Response.json({ error: 'invalid boat config shape' }, { status: 422 });
  }
  await store.setBoatConfig(body);
  return Response.json({ ok: true });
}

function validate(v: unknown): v is BoatConfig {
  if (!v || typeof v !== 'object') return false;
  const o = v as Record<string, unknown>;
  return (
    typeof o.mastHeight === 'number' &&
    typeof o.mastheadOffsetX === 'number' &&
    typeof o.mastheadOffsetY === 'number' &&
    typeof o.magVarDeg === 'number'
  );
}
