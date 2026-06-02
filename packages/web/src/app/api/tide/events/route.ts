import { NextResponse } from 'next/server';
import { getTidalEvents } from '@g5000/tide';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const cache = new Map<string, { day: number; events: unknown }>();

export async function GET(req: Request): Promise<NextResponse> {
  const key = process.env.ADMIRALTY_TIDAL_API_KEY;
  if (!key) {
    return NextResponse.json({ ok: false, error: 'tide not configured' }, { status: 503 });
  }
  const stationId = new URL(req.url).searchParams.get('stationId');
  if (!stationId) {
    return NextResponse.json({ ok: false, error: 'stationId required' }, { status: 400 });
  }
  const day = Math.floor(Date.now() / 86_400_000);
  const hit = cache.get(stationId);
  if (hit && hit.day === day) {
    return NextResponse.json({ ok: true, events: hit.events });
  }
  try {
    const events = await getTidalEvents(key, stationId, 7);
    cache.set(stationId, { day, events });
    return NextResponse.json({ ok: true, events });
  } catch (e) {
    return NextResponse.json({ ok: false, error: String(e) }, { status: 502 });
  }
}
