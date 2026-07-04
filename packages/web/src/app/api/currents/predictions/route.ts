import { NextResponse } from 'next/server';
import { chsGetCurrentPredictions, chsGetCurrentEvents } from '@g5000/tide';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const cache = new Map<string, { day: number; predictions: unknown; events: unknown }>();

export async function GET(req: Request): Promise<NextResponse> {
  const stationId = new URL(req.url).searchParams.get('stationId');
  if (!stationId)
    return NextResponse.json({ ok: false, error: 'stationId required' }, { status: 400 });
  const day = Math.floor(Date.now() / 86_400_000);
  const hit = cache.get(stationId);
  if (hit && hit.day === day) {
    return NextResponse.json({ ok: true, predictions: hit.predictions, events: hit.events });
  }
  try {
    const [predictions, events] = await Promise.all([
      chsGetCurrentPredictions(stationId, 48),
      chsGetCurrentEvents(stationId, 48),
    ]);
    cache.set(stationId, { day, predictions, events });
    return NextResponse.json({ ok: true, predictions, events });
  } catch (e) {
    return NextResponse.json({ ok: false, error: String(e) }, { status: 502 });
  }
}
