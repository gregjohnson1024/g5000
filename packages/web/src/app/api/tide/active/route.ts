import { NextResponse } from 'next/server';
import { getSharedConfigStore } from '@g5000/db';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(): Promise<NextResponse> {
  const cfg = getSharedConfigStore().getTideConfig();
  const pin = cfg.pinnedStation;
  let name: string | null = null;
  if (pin) {
    name = cfg.stationsCacheBySource[pin.sourceId]?.stations.find((s) => s.id === pin.stationId)?.name ?? null;
  }
  return NextResponse.json({
    ok: true,
    tideSource: cfg.tideSource,
    pinned: pin !== null,
    pinnedStationId: pin?.stationId ?? null,
    pinnedSourceId: pin?.sourceId ?? null,
    pinnedName: name,
  });
}
