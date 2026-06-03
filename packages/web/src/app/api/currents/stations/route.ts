import { NextResponse } from 'next/server';
import { chsListCurrentStations } from '@g5000/tide';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

let cache: { at: number; stations: unknown } | null = null;
const TTL_MS = 7 * 86_400_000;

export async function GET(): Promise<NextResponse> {
  if (cache && Date.now() - cache.at < TTL_MS) {
    return NextResponse.json({ ok: true, stations: cache.stations });
  }
  try {
    const stations = await chsListCurrentStations();
    cache = { at: Date.now(), stations };
    return NextResponse.json({ ok: true, stations });
  } catch (e) {
    return NextResponse.json({ ok: false, error: String(e) }, { status: 502 });
  }
}
