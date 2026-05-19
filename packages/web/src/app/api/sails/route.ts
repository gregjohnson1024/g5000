import { NextResponse } from 'next/server';
import { firstValueFrom } from 'rxjs';
import { getSharedConfigStore, type SailWardrobe } from '@g5000/db';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(): Promise<Response> {
  const store = getSharedConfigStore();
  const w = await firstValueFrom(store.sails$);
  return NextResponse.json(w);
}

export async function PUT(req: Request): Promise<Response> {
  const store = getSharedConfigStore();
  let body: SailWardrobe;
  try {
    body = (await req.json()) as SailWardrobe;
  } catch {
    return NextResponse.json({ error: 'invalid JSON' }, { status: 400 });
  }
  try {
    await store.setSails(body);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 400 },
    );
  }
  return NextResponse.json({ ok: true });
}
