import { NextResponse } from 'next/server';
import { getSharedConfigStore } from '@g5000/db';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function POST(req: Request): Promise<NextResponse> {
  let body: unknown;
  try { body = await req.json(); } catch { return NextResponse.json({ ok: false, error: 'invalid JSON' }, { status: 400 }); }
  const b = body as { stationId?: unknown; sourceId?: unknown };
  const store = getSharedConfigStore();
  const cfg = store.getTideConfig();
  if (b.stationId === null) {
    await store.setTideConfig({ ...cfg, pinnedStation: null });
    return NextResponse.json({ ok: true });
  }
  if (typeof b.stationId !== 'string' || (b.sourceId !== 'admiralty' && b.sourceId !== 'chs')) {
    return NextResponse.json({ ok: false, error: 'stationId (string) + sourceId (admiralty|chs), or stationId:null' }, { status: 400 });
  }
  await store.setTideConfig({ ...cfg, pinnedStation: { sourceId: b.sourceId, stationId: b.stationId } });
  return NextResponse.json({ ok: true });
}
