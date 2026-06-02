import { NextResponse } from 'next/server';
import { getSharedConfigStore } from '@g5000/db';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(): Promise<NextResponse> {
  const store = getSharedConfigStore();
  const cache = store.getTideConfig().stationsCache ?? null;
  if (!cache) {
    return NextResponse.json(
      { ok: false, error: 'tide not configured or station list not yet loaded' },
      { status: 503 },
    );
  }
  return NextResponse.json({ ok: true, stations: cache.stations });
}
