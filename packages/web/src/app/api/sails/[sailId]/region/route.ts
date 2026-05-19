import { NextResponse } from 'next/server';
import { firstValueFrom } from 'rxjs';
import { getSharedConfigStore } from '@g5000/db';
import type { SailWardrobe } from '@g5000/db';
import { parseCellKey } from '@g5000/core';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

interface Params {
  params: Promise<{ sailId: string }>;
}

export async function POST(req: Request, ctx: Params): Promise<Response> {
  const { sailId } = await ctx.params;
  let body: { cells: string[] };
  try {
    body = (await req.json()) as { cells: string[] };
  } catch {
    return NextResponse.json({ error: 'invalid JSON' }, { status: 400 });
  }
  if (!Array.isArray(body.cells)) {
    return NextResponse.json({ error: 'cells must be an array' }, { status: 400 });
  }
  for (const key of body.cells) {
    if (typeof key !== 'string' || parseCellKey(key) === null) {
      return NextResponse.json({ error: `invalid cell key "${key}"` }, { status: 400 });
    }
  }
  const store = getSharedConfigStore();
  const w = await firstValueFrom(store.sails$);
  const sail = w.sails.find((s) => s.id === sailId);
  if (!sail) {
    return NextResponse.json({ error: `sail "${sailId}" not found` }, { status: 404 });
  }
  const unique = Array.from(new Set(body.cells)).sort();
  const updated: SailWardrobe = {
    ...w,
    sails: w.sails.map((s) => (s.id === sailId ? { ...s, region: { cells: unique } } : s)),
  };
  await store.setSails(updated);
  return NextResponse.json({ ok: true });
}
