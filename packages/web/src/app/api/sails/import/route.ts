import { firstValueFrom } from 'rxjs';
import { getSharedConfigStore } from '@g5000/db';
import { parseExpeditionPolar } from '@g5000/compute';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function POST(req: Request): Promise<Response> {
  const store = getSharedConfigStore();
  const url = new URL(req.url);
  const configId = url.searchParams.get('configId');
  if (!configId) {
    return Response.json(
      { error: 'configId query param required' },
      { status: 400 },
    );
  }
  const csv = await req.text();
  if (!csv || csv.length === 0) {
    return Response.json({ error: 'empty body' }, { status: 400 });
  }
  let polar;
  try {
    polar = parseExpeditionPolar(csv);
  } catch (e) {
    return Response.json(
      { error: e instanceof Error ? e.message : String(e) },
      { status: 422 },
    );
  }
  const wardrobe = await firstValueFrom(store.sails$);
  const idx = wardrobe.configs.findIndex((c) => c.id === configId);
  if (idx < 0) {
    return Response.json({ error: 'unknown configId' }, { status: 422 });
  }
  const newConfigs = wardrobe.configs.slice();
  newConfigs[idx] = { ...newConfigs[idx]!, polar };
  await store.setSails({ ...wardrobe, configs: newConfigs });
  return Response.json({
    ok: true,
    twsBinCount: polar.twsBins.length,
    twaBinCount: polar.twaBins.length,
  });
}
