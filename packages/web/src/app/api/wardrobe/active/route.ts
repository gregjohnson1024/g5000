import { firstValueFrom } from 'rxjs';
import { getSharedConfigStore } from '@g5000/db';
import type { PolarMode, SailWardrobe } from '@g5000/db';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * Read-only JSON endpoint that returns the active SailConfig (sail wardrobe
 * entry whose id matches the wardrobe's activeConfigId). Consumed by the
 * Mac router app so it can mirror the running boat's active polar.
 */
export async function GET(): Promise<Response> {
  try {
    const store = getSharedConfigStore();
    const wardrobe = await firstValueFrom(store.sails$);
    const active = wardrobe.configs.find((c) => c.id === wardrobe.activeConfigId);
    if (!active) {
      return Response.json(
        { error: { kind: 'not_found', message: 'No active wardrobe entry' } },
        { status: 404 },
      );
    }
    return Response.json(active);
  } catch (err) {
    return Response.json(
      { error: { kind: 'internal', message: err instanceof Error ? err.message : String(err) } },
      { status: 500 },
    );
  }
}

/**
 * Update the wardrobe's active pointer. Accepts `activeConfigId` (required)
 * and an optional `activeMode`. When `activeMode` is absent, the existing
 * wardrobe's `activeMode` is preserved (and falls back to `'default'` if
 * unset).
 */
export async function POST(req: Request): Promise<Response> {
  const store = getSharedConfigStore();
  let body: { activeConfigId?: string; activeMode?: string };
  try {
    body = (await req.json()) as { activeConfigId?: string; activeMode?: string };
  } catch {
    return Response.json({ error: 'invalid JSON' }, { status: 400 });
  }
  if (typeof body.activeConfigId !== 'string') {
    return Response.json({ error: 'activeConfigId required (string)' }, { status: 422 });
  }
  const wardrobe = await firstValueFrom(store.sails$);
  if (!wardrobe.configs.find((c) => c.id === body.activeConfigId)) {
    return Response.json({ error: 'unknown activeConfigId' }, { status: 422 });
  }
  const next: SailWardrobe = {
    ...wardrobe,
    activeConfigId: body.activeConfigId,
    activeMode: (body.activeMode as PolarMode) ?? wardrobe.activeMode ?? 'default',
  };
  await store.setSails(next);
  return Response.json({ ok: true, activeConfigId: next.activeConfigId, activeMode: next.activeMode });
}
