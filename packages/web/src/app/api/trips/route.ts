import { NextResponse } from 'next/server';
import { getSharedConfigStore, listTrips, type Trip } from '@g5000/db';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const activeBoatId = (): string => process.env.G5000_BOAT_ID ?? 'sula';

const msParam = (url: URL, name: string): number | undefined => {
  const raw = url.searchParams.get(name);
  if (raw === null || raw === '') return undefined;
  const n = Number(raw);
  return Number.isFinite(n) ? n : undefined;
};

interface TripWithStay extends Trip {
  /**
   * Seconds from this trip's end to the next (chronologically later) trip's
   * start — the duration of the stay this trip began. Null when the next trip
   * is unknown (newest row of the page, or the stay is still open).
   */
  stayDurationS: number | null;
}

/**
 * GET /api/trips?limit=&before=&from=&to=
 * Trips newest-first, scoped to the active boat. Cursor pagination on
 * startMs: pass the last row's startMs as `before` for the next page.
 */
export async function GET(req: Request): Promise<NextResponse> {
  const url = new URL(req.url);
  const limitRaw = Number(url.searchParams.get('limit') ?? '100');
  const limit = Number.isFinite(limitRaw) ? Math.min(500, Math.max(1, Math.trunc(limitRaw))) : 100;

  const store = getSharedConfigStore();
  const rows = await listTrips(store, {
    boatId: activeBoatId(),
    limit,
    beforeMs: msParam(url, 'before'),
    fromMs: msParam(url, 'from'),
    toMs: msParam(url, 'to'),
  });

  // Rows are newest-first, so the adjacent earlier index holds the next
  // chronological trip. The newest row's stay end is off-page → null.
  const trips: TripWithStay[] = rows.map((t, i) => {
    const next = i > 0 ? rows[i - 1] : undefined;
    const stayDurationS =
      next !== undefined ? Math.max(0, Math.round((next.startMs - t.endMs) / 1000)) : null;
    return { ...t, stayDurationS };
  });

  return NextResponse.json({ ok: true, trips });
}
