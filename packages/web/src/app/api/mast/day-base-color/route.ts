import { NextResponse } from 'next/server';
import { getSharedConfigStore } from '@g5000/db';
import { DAY_BASE_COLORS, type DayBaseColor } from '@g5000/mast';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(): Promise<NextResponse> {
  const { dayBaseColor } = getSharedConfigStore().getDisplayConfig();
  return NextResponse.json({ ok: true, dayBaseColor });
}

export async function POST(req: Request): Promise<NextResponse> {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: 'invalid JSON' }, { status: 400 });
  }
  const b = body as { dayBaseColor?: unknown };
  if (
    typeof b.dayBaseColor !== 'string' ||
    !(DAY_BASE_COLORS as readonly string[]).includes(b.dayBaseColor)
  ) {
    return NextResponse.json(
      { ok: false, error: `dayBaseColor must be one of: ${DAY_BASE_COLORS.join(', ')}` },
      { status: 400 },
    );
  }
  const store = getSharedConfigStore();
  await store.setDisplayConfig({
    ...store.getDisplayConfig(),
    dayBaseColor: b.dayBaseColor as DayBaseColor,
  });
  return NextResponse.json({ ok: true, dayBaseColor: b.dayBaseColor });
}
