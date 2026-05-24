import { getSharedConfigStore, type BoatState } from '@g5000/db';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const ALLOWED_PCT = new Set([0, 25, 50, 75, 100]);

export async function GET(): Promise<Response> {
  return Response.json({ ok: true, boatState: getSharedConfigStore().getBoatState() });
}

export async function POST(req: Request): Promise<Response> {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return Response.json({ ok: false, error: { message: 'invalid JSON' } }, { status: 400 });
  }
  const b = body as {
    daggerboards?: { port?: unknown; starboard?: unknown };
    engines?: { port?: { running?: unknown }; starboard?: { running?: unknown } };
  };

  const store = getSharedConfigStore();
  const cur = store.getBoatState();
  const next: BoatState = {
    daggerboards: { ...cur.daggerboards },
    engines: { port: { ...cur.engines.port }, starboard: { ...cur.engines.starboard } },
  };

  for (const side of ['port', 'starboard'] as const) {
    const v = b.daggerboards?.[side];
    if (v !== undefined) {
      if (typeof v !== 'number' || !ALLOWED_PCT.has(v)) {
        return Response.json(
          { ok: false, error: { message: `daggerboard ${side} must be one of 0/25/50/75/100` } },
          { status: 422 },
        );
      }
      next.daggerboards[side] = v;
    }
    const run = b.engines?.[side]?.running;
    if (run !== undefined) {
      if (typeof run !== 'boolean') {
        return Response.json(
          { ok: false, error: { message: `engine ${side} running must be boolean` } },
          { status: 422 },
        );
      }
      next.engines[side] = { running: run };
    }
  }

  await store.setBoatState(next);
  return Response.json({ ok: true, boatState: next });
}
