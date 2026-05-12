import { firstValueFrom } from 'rxjs';
import { getSharedConfigStore } from '@g5000/db';

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
