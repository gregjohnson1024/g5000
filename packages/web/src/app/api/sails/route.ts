import { firstValueFrom } from 'rxjs';
import { getSharedConfigStore, type SailWardrobe } from '@g5000/db';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(): Promise<Response> {
  const store = getSharedConfigStore();
  const w = await firstValueFrom(store.sails$);
  return Response.json(w);
}

export async function PUT(req: Request): Promise<Response> {
  const store = getSharedConfigStore();
  let body: SailWardrobe;
  try {
    body = (await req.json()) as SailWardrobe;
  } catch {
    return Response.json({ error: 'invalid JSON' }, { status: 400 });
  }
  if (!validate(body)) {
    return Response.json({ error: 'invalid wardrobe shape' }, { status: 422 });
  }
  try {
    await store.setSails(body);
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : String(e) }, { status: 422 });
  }
  return Response.json({ ok: true });
}

function validate(v: unknown): v is SailWardrobe {
  if (!v || typeof v !== 'object') return false;
  const o = v as Record<string, unknown>;
  if (typeof o.activeConfigId !== 'string') return false;
  if (!Array.isArray(o.configs) || o.configs.length === 0) return false;
  for (const c of o.configs as unknown[]) {
    if (!c || typeof c !== 'object') return false;
    const cc = c as Record<string, unknown>;
    if (typeof cc.id !== 'string' || typeof cc.name !== 'string') return false;
    // v2 SailConfig: `modes` is the per-mode revision pointer (may be empty
    // {} on a freshly-added config). `polar` is the legacy inline polar,
    // optional and drained into a revision row by the v1→v2 migrator.
    if (!cc.modes || typeof cc.modes !== 'object') return false;
    if (cc.polar !== undefined) {
      if (!cc.polar || typeof cc.polar !== 'object') return false;
      const p = cc.polar as Record<string, unknown>;
      if (!Array.isArray(p.twsBins) || !Array.isArray(p.twaBins) || !Array.isArray(p.boatSpeed))
        return false;
    }
  }
  return true;
}
