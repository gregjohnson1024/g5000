import { NextResponse } from 'next/server';
import { createTideSources, getTideSource } from '@g5000/tide';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const cache = new Map<string, { day: number; events: unknown }>();

export async function GET(req: Request): Promise<NextResponse> {
  const url = new URL(req.url);
  const stationId = url.searchParams.get('stationId');
  const sourceId = url.searchParams.get('source');
  if (!stationId || !sourceId) {
    return NextResponse.json({ ok: false, error: 'stationId and source required' }, { status: 400 });
  }
  const sources = createTideSources({ getAdmiraltyKey: () => process.env.ADMIRALTY_TIDAL_API_KEY });
  const source = getTideSource(sources, sourceId);
  if (!source || !source.available()) {
    return NextResponse.json({ ok: false, error: 'source unavailable' }, { status: 503 });
  }
  const key = `${sourceId}:${stationId}`;
  const day = Math.floor(Date.now() / 86_400_000);
  const hit = cache.get(key);
  if (hit && hit.day === day) return NextResponse.json({ ok: true, events: hit.events });
  try {
    const events = await source.getTidalEvents(stationId, 7);
    cache.set(key, { day, events });
    return NextResponse.json({ ok: true, events });
  } catch (e) {
    return NextResponse.json({ ok: false, error: String(e) }, { status: 502 });
  }
}
