import { NextResponse } from 'next/server';
import { getSharedConfigStore } from '@g5000/db';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(): Promise<NextResponse> {
  const { brightnessPct } = getSharedConfigStore().getDisplayConfig();
  return NextResponse.json({ ok: true, brightnessPct });
}

export async function POST(req: Request): Promise<NextResponse> {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: 'invalid JSON' }, { status: 400 });
  }
  const b = body as { brightnessPct?: unknown };
  if (
    typeof b.brightnessPct !== 'number' ||
    !Number.isInteger(b.brightnessPct) ||
    b.brightnessPct < 0 ||
    b.brightnessPct > 100
  ) {
    return NextResponse.json(
      { ok: false, error: 'brightnessPct must be an integer 0–100' },
      { status: 400 },
    );
  }
  const store = getSharedConfigStore();
  await store.setDisplayConfig({ ...store.getDisplayConfig(), brightnessPct: b.brightnessPct });
  return NextResponse.json({ ok: true, brightnessPct: b.brightnessPct });
}
