import { NextResponse } from 'next/server';
import { getSharedConfigStore } from '@g5000/db';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(): Promise<NextResponse> {
  const store = getSharedConfigStore();
  const cache = store.getTideConfig().stationsCacheBySource;
  const sources: Record<string, unknown> = {};
  for (const [id, c] of Object.entries(cache)) sources[id] = c?.stations ?? [];
  return NextResponse.json({ ok: true, sources });
}
