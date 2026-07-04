import { NextResponse } from 'next/server';
import { getSharedConfigStore, listTrips } from '@g5000/db';
import { computeTripStats } from '../../../../lib/trip-stats';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const activeBoatId = (): string => process.env.G5000_BOAT_ID ?? 'sula';

/** Effectively unbounded: stats want every trip in the window. */
const STATS_LIMIT = 100_000;

const msParam = (url: URL, name: string): number | undefined => {
  const raw = url.searchParams.get(name);
  if (raw === null || raw === '') return undefined;
  const n = Number(raw);
  return Number.isFinite(n) ? n : undefined;
};

/**
 * GET /api/trips/stats?from=&to= — aggregate statistics over all trips whose
 * startMs falls in the (optional) [from, to] epoch-ms window.
 */
export async function GET(req: Request): Promise<NextResponse> {
  const url = new URL(req.url);
  const store = getSharedConfigStore();
  const trips = await listTrips(store, {
    boatId: activeBoatId(),
    limit: STATS_LIMIT,
    fromMs: msParam(url, 'from'),
    toMs: msParam(url, 'to'),
  });
  return NextResponse.json({ ok: true, stats: computeTripStats(trips) });
}
