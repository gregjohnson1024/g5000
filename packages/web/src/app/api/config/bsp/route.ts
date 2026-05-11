import { firstValueFrom } from 'rxjs';
import { getSharedConfigStore, type BspCal } from '@g5000/db';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(): Promise<Response> {
  const store = getSharedConfigStore();
  const cal = await firstValueFrom(store.bspCal$);
  return Response.json(cal);
}

export async function PUT(req: Request): Promise<Response> {
  const store = getSharedConfigStore();
  let body: BspCal;
  try {
    body = (await req.json()) as BspCal;
  } catch {
    return Response.json({ error: 'invalid JSON' }, { status: 400 });
  }
  if (
    !body ||
    !Array.isArray(body.bins) ||
    !Array.isArray(body.multiplier) ||
    body.bins.length !== body.multiplier.length
  ) {
    return Response.json({ error: 'invalid BSP cal shape' }, { status: 422 });
  }
  await store.setBspCal(body);
  return Response.json({ ok: true });
}
