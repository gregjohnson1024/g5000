import { firstValueFrom } from 'rxjs';
import { getSharedConfigStore } from '@g5000/db';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * Read-only JSON endpoint that returns the currently-active polar table and
 * the wardrobe's `activeMode`. In v3 (atomic sails) there is no
 * `activeConfigId` — `activePolar$` resolves to the newest PolarRevision for
 * `(activeBoatId, activeMode)`. Consumers (chart route planner, status badge)
 * only need the polar table + a stable id-ish tag for caching.
 *
 * Response shape:
 *   { id: <activeMode>, polar: PolarTable, activeMode: <PolarMode> }
 */
export async function GET(): Promise<Response> {
  try {
    const store = getSharedConfigStore();
    const [polar, wardrobe] = await Promise.all([
      firstValueFrom(store.activePolar$),
      firstValueFrom(store.sails$),
    ]);
    return Response.json({
      id: wardrobe.activeMode,
      polar,
      activeMode: wardrobe.activeMode,
    });
  } catch (err) {
    return Response.json(
      { error: { kind: 'internal', message: err instanceof Error ? err.message : String(err) } },
      { status: 500 },
    );
  }
}

/**
 * In v2 this endpoint flipped the wardrobe's `activeConfigId` pointer. v3
 * has no per-sail-config polar — the active polar is the newest revision for
 * the boat's `activeMode`. There is no clean v3 equivalent, so this returns
 * 501 to surface the change to any stale clients.
 */
export async function POST(): Promise<Response> {
  return Response.json(
    {
      error: {
        kind: 'not_implemented',
        message:
          "POST /api/wardrobe/active is not implemented in v3. There is no per-sail-config polar; the active polar is the newest revision for the boat's activeMode.",
      },
    },
    { status: 501 },
  );
}
