import { firstValueFrom } from 'rxjs';
import { getSharedConfigStore, type CompassDeviation } from '@g5000/db';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(): Promise<Response> {
  const store = getSharedConfigStore();
  const cal = await firstValueFrom(store.compassDeviation$);
  return Response.json(cal);
}

export async function PUT(req: Request): Promise<Response> {
  const store = getSharedConfigStore();
  let body: CompassDeviation;
  try {
    body = (await req.json()) as CompassDeviation;
  } catch {
    return Response.json({ error: 'invalid JSON' }, { status: 400 });
  }
  if (
    !body ||
    !Array.isArray(body.deviation) ||
    body.deviation.length !== 36 ||
    !body.deviation.every((n) => Number.isFinite(n))
  ) {
    return Response.json(
      { error: 'invalid compass deviation (need 36 finite numbers)' },
      { status: 422 },
    );
  }
  await store.setCompassDeviation(body);
  return Response.json({ ok: true });
}
