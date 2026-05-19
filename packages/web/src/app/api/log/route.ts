import { NextResponse } from 'next/server';
import {
  getSharedConfigStore,
  insertShipLogEntry,
  listShipLogEntries,
  type ShipLogKind,
} from '@g5000/db';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const VALID_KINDS: ReadonlySet<ShipLogKind> = new Set([
  'note',
  'position',
  'weather',
  'equipment',
  'incident',
  'crew',
]);

const activeBoatId = (): string => process.env.G5000_BOAT_ID ?? 'sula';

/**
 * GET /api/log?limit=&before=&source=&kind=&q=
 * Returns ship's log entries newest-first, scoped to the active boat.
 */
export async function GET(req: Request): Promise<NextResponse> {
  const url = new URL(req.url);
  const limitRaw = Number(url.searchParams.get('limit') ?? '100');
  const limit = Number.isFinite(limitRaw) ? Math.min(500, Math.max(1, Math.trunc(limitRaw))) : 100;
  const beforeRaw = url.searchParams.get('before');
  const beforeMs = beforeRaw && Number.isFinite(Number(beforeRaw)) ? Number(beforeRaw) : undefined;
  const source = url.searchParams.get('source');
  const kind = url.searchParams.get('kind');
  const q = url.searchParams.get('q') ?? undefined;

  const store = getSharedConfigStore();
  const entries = await listShipLogEntries(store, {
    boatId: activeBoatId(),
    limit,
    beforeMs,
    source: source === 'manual' || source === 'auto' ? source : undefined,
    kind: kind && VALID_KINDS.has(kind as ShipLogKind) ? (kind as ShipLogKind) : undefined,
    q,
  });
  return NextResponse.json({ entries });
}

interface PostBody {
  text?: string;
  kind?: string;
  author?: string;
  /** Snapshot fields supplied by the client (it has SSE state). */
  lat?: number;
  lon?: number;
  cogDeg?: number;
  sogKn?: number;
  hdgDeg?: number;
  twsKn?: number;
  twdDeg?: number;
}

/**
 * POST /api/log
 * Insert a manual entry. The client supplies any nav snapshot it has from
 * its SSE stream; missing fields are stored as NULL.
 */
export async function POST(req: Request): Promise<NextResponse> {
  let body: PostBody;
  try {
    body = (await req.json()) as PostBody;
  } catch {
    return NextResponse.json({ ok: false, error: 'invalid json' }, { status: 400 });
  }

  const text = (body.text ?? '').trim();
  if (text.length === 0) {
    return NextResponse.json({ ok: false, error: 'text required' }, { status: 400 });
  }
  const kind: ShipLogKind =
    body.kind && VALID_KINDS.has(body.kind as ShipLogKind) ? (body.kind as ShipLogKind) : 'note';

  const numOrNull = (v: unknown): number | null =>
    typeof v === 'number' && Number.isFinite(v) ? v : null;

  const store = getSharedConfigStore();
  const id = await insertShipLogEntry(store, {
    tsMs: Date.now(),
    source: 'manual',
    kind,
    text,
    author: body.author?.trim() || null,
    lat: numOrNull(body.lat),
    lon: numOrNull(body.lon),
    cogDeg: numOrNull(body.cogDeg),
    sogKn: numOrNull(body.sogKn),
    hdgDeg: numOrNull(body.hdgDeg),
    twsKn: numOrNull(body.twsKn),
    twdDeg: numOrNull(body.twdDeg),
    boatId: activeBoatId(),
  });
  return NextResponse.json({ ok: true, id });
}
