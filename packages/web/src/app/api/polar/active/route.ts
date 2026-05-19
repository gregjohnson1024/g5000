import { firstValueFrom } from 'rxjs';
import { getSharedConfigStore } from '@g5000/db';

export async function GET(): Promise<Response> {
  try {
    const store = getSharedConfigStore();
    const polar = await firstValueFrom(store.activePolar$);
    return Response.json({ ok: true, polar });
  } catch (err) {
    return Response.json(
      { ok: false, error: { message: err instanceof Error ? err.message : String(err) } },
      { status: 500 },
    );
  }
}

/**
 * In v2 this endpoint flipped which PolarRevision was "active" for a given
 * (sailConfigId, mode) slot. v3 dropped per-config polar slots — the active
 * polar is simply the newest revision for `(boatId, activeMode)`. There is no
 * clean v3 equivalent, so this returns 501 to surface the change to callers.
 *
 * If you want to make a different polar active, write a new revision (copying
 * the table you want) via createRevision() — activePolar$ resolves to the
 * newest revision for the active mode.
 */
export async function POST(): Promise<Response> {
  return Response.json(
    {
      error: {
        kind: 'not_implemented',
        message:
          'POST /api/polar/active is not implemented in v3. Write a new PolarRevision (copying the desired table) to make it the active polar for (boatId, activeMode).',
      },
    },
    { status: 501 },
  );
}
