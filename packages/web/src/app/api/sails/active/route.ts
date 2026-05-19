import { NextResponse } from 'next/server';
import { firstValueFrom } from 'rxjs';
import { getSharedConfigStore, SAIL_CATEGORIES } from '@g5000/db';
import type { SailCategory, SailWardrobe } from '@g5000/db';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function POST(req: Request): Promise<Response> {
  let body: { category: SailCategory; sailId: string | null };
  try {
    body = (await req.json()) as { category: SailCategory; sailId: string | null };
  } catch {
    return NextResponse.json({ error: 'invalid JSON' }, { status: 400 });
  }
  if (!SAIL_CATEGORIES.includes(body.category)) {
    return NextResponse.json(
      { error: `unknown category "${body.category}"` },
      { status: 400 },
    );
  }
  const store = getSharedConfigStore();
  const w = await firstValueFrom(store.sails$);
  if (body.sailId !== null) {
    const sail = w.sails.find((s) => s.id === body.sailId);
    if (!sail) {
      return NextResponse.json({ error: `unknown sail "${body.sailId}"` }, { status: 400 });
    }
    if (sail.category !== body.category) {
      return NextResponse.json(
        {
          error: `sail "${body.sailId}" is category "${sail.category}", not "${body.category}"`,
        },
        { status: 400 },
      );
    }
  }
  const active: SailWardrobe['active'] = { ...w.active, [body.category]: body.sailId ?? undefined };
  for (const k of Object.keys(active) as SailCategory[]) {
    if (active[k] === undefined) delete active[k];
  }
  await store.setSails({ ...w, active });
  return NextResponse.json({ ok: true });
}
