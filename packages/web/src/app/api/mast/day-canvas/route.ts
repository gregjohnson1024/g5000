import { NextResponse } from 'next/server';
import { getSharedConfigStore } from '@g5000/db';
import { DAY_CANVASES, type DayCanvas } from '@g5000/mast';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(): Promise<NextResponse> {
  const { dayCanvas } = getSharedConfigStore().getDisplayConfig();
  return NextResponse.json({ ok: true, dayCanvas });
}

export async function POST(req: Request): Promise<NextResponse> {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: 'invalid JSON' }, { status: 400 });
  }
  const b = body as { dayCanvas?: unknown };
  if (
    typeof b.dayCanvas !== 'string' ||
    !(DAY_CANVASES as readonly string[]).includes(b.dayCanvas)
  ) {
    return NextResponse.json(
      { ok: false, error: `dayCanvas must be one of: ${DAY_CANVASES.join(', ')}` },
      { status: 400 },
    );
  }
  const store = getSharedConfigStore();
  await store.setDisplayConfig({
    ...store.getDisplayConfig(),
    dayCanvas: b.dayCanvas as DayCanvas,
  });
  return NextResponse.json({ ok: true, dayCanvas: b.dayCanvas });
}
