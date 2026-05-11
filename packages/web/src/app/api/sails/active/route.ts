import { firstValueFrom } from 'rxjs';
import { getSharedConfigStore } from '@g5000/db';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function PUT(req: Request): Promise<Response> {
  const store = getSharedConfigStore();
  let body: { configId?: string };
  try {
    body = (await req.json()) as { configId?: string };
  } catch {
    return Response.json({ error: 'invalid JSON' }, { status: 400 });
  }
  if (typeof body.configId !== 'string') {
    return Response.json({ error: 'configId required (string)' }, { status: 422 });
  }
  const wardrobe = await firstValueFrom(store.sails$);
  if (!wardrobe.configs.find((c) => c.id === body.configId)) {
    return Response.json({ error: 'unknown configId' }, { status: 422 });
  }
  await store.setSails({ ...wardrobe, activeConfigId: body.configId });
  return Response.json({ ok: true, activeConfigId: body.configId });
}
