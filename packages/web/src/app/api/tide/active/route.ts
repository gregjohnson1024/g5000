import { NextResponse } from 'next/server';
import { getSharedConfigStore } from '@g5000/db';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(): Promise<NextResponse> {
  const store = getSharedConfigStore();
  const cfg = store.getTideConfig();
  const pinned = cfg.pinnedStationId != null;
  const st = pinned
    ? (cfg.stationsCache?.stations.find((s) => s.id === cfg.pinnedStationId) ?? null)
    : null;
  return NextResponse.json({ ok: true, pinned, stationId: cfg.pinnedStationId, name: st?.name ?? null });
}
