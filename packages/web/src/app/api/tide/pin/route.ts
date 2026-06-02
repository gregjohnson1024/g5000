import { NextResponse } from 'next/server';
import { getSharedConfigStore } from '@g5000/db';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function POST(req: Request): Promise<NextResponse> {
  const store = getSharedConfigStore();
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: 'invalid JSON' }, { status: 400 });
  }
  const stationId = (body as { stationId?: unknown }).stationId;
  if (stationId !== null && typeof stationId !== 'string') {
    return NextResponse.json(
      { ok: false, error: 'stationId must be string or null' },
      { status: 400 },
    );
  }
  await store.setTideConfig({ ...store.getTideConfig(), pinnedStationId: stationId });
  return NextResponse.json({ ok: true });
}
