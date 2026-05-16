import { getSharedConfigStore } from '@g5000/db';
import { activeTrack } from '../../../../lib/tracks';
import { distanceInWindow } from '../../../../lib/distance-stats';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * Passage log — the maritime "log" (distance instrument).
 *
 * GET  returns the current anchor and the over-ground distance summed
 *      from `anchorAt` to now using the active track's points.
 *
 * POST `{ resetToNow: true }` re-anchors to the current server time.
 *      `{ anchorAt: <unixSec> }` sets the anchor to an explicit value
 *      (e.g. the start of a passage entered after the fact).
 *
 * Distance is metres; clients convert to NM (× 1/1852).
 */

export async function GET(): Promise<Response> {
  try {
    const log = getSharedConfigStore().getPassageLog();
    const distanceM = await computeDistance(log.anchorAt);
    return Response.json({ ok: true, log: { anchorAt: log.anchorAt, distanceM } });
  } catch (err) {
    return Response.json(
      {
        ok: false,
        error: {
          kind: 'internal',
          message: err instanceof Error ? err.message : String(err),
        },
      },
      { status: 500 },
    );
  }
}

export async function POST(req: Request): Promise<Response> {
  try {
    const body = (await req.json().catch(() => ({}))) as {
      resetToNow?: boolean;
      anchorAt?: number;
    };
    const store = getSharedConfigStore();
    let anchorAt: number;
    if (body.resetToNow) {
      anchorAt = Math.floor(Date.now() / 1000);
    } else if (typeof body.anchorAt === 'number' && Number.isFinite(body.anchorAt) && body.anchorAt > 0) {
      anchorAt = body.anchorAt;
    } else {
      return Response.json(
        {
          ok: false,
          error: { kind: 'bad_request', message: 'send {resetToNow:true} or {anchorAt:<unixSec>}' },
        },
        { status: 400 },
      );
    }
    await store.setPassageLog({ anchorAt });
    const distanceM = await computeDistance(anchorAt);
    return Response.json({ ok: true, log: { anchorAt, distanceM } });
  } catch (err) {
    return Response.json(
      {
        ok: false,
        error: {
          kind: 'internal',
          message: err instanceof Error ? err.message : String(err),
        },
      },
      { status: 500 },
    );
  }
}

async function computeDistance(anchorAt: number | null): Promise<number> {
  if (anchorAt === null) return 0;
  const track = await activeTrack();
  if (!track || track.points.length === 0) return 0;
  return distanceInWindow(track.points, anchorAt, Date.now() / 1000);
}
