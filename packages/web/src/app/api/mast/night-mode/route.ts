import { NextResponse } from 'next/server';
import { getSharedConfigStore } from '@g5000/db';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(): Promise<NextResponse> {
  const { nightMode } = getSharedConfigStore().getDisplayConfig();
  return NextResponse.json({ ok: true, nightMode });
}

export async function POST(req: Request): Promise<NextResponse> {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: 'invalid JSON' }, { status: 400 });
  }
  const b = body as { nightMode?: unknown };
  if (typeof b.nightMode !== 'boolean') {
    return NextResponse.json({ ok: false, error: 'nightMode must be a boolean' }, { status: 400 });
  }
  const store = getSharedConfigStore();
  await store.setDisplayConfig({ ...store.getDisplayConfig(), nightMode: b.nightMode });
  return NextResponse.json({ ok: true, nightMode: b.nightMode });
}
