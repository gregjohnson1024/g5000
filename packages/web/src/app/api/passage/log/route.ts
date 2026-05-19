import { getSharedConfigStore } from '@g5000/db';
import { activeTrack } from '../../../../lib/tracks';
import { distanceInWindow } from '../../../../lib/distance-stats';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const HOUR = 3600;
/** Cap sparkline to a reasonable number of buckets even on a 30-day passage.
 *  At >MAX_BUCKETS, we widen the bucket size to keep the array bounded. */
const MAX_BUCKETS = 200;

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
    const { distanceM, history } = await computeDistanceAndHistory(log.anchorAt);
    return Response.json({
      ok: true,
      log: { anchorAt: log.anchorAt, distanceM, history },
    });
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
    } else if (
      typeof body.anchorAt === 'number' &&
      Number.isFinite(body.anchorAt) &&
      body.anchorAt > 0
    ) {
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
    const { distanceM, history } = await computeDistanceAndHistory(anchorAt);
    return Response.json({ ok: true, log: { anchorAt, distanceM, history } });
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

interface HistoryPoint {
  /** UNIX seconds at the END of this bucket. */
  t: number;
  /** Cumulative NM-equivalent distance from anchor to this bucket end, in metres. */
  cumulativeM: number;
}

/**
 * Returns the total since-anchor distance plus a cumulative-distance series
 * sampled at evenly-spaced bucket boundaries. Bucket width starts at 1 h and
 * widens (2 h, 4 h, …) once the series would exceed MAX_BUCKETS points, so
 * the response stays bounded even on a multi-week passage. The last point
 * is always anchored to `nowS` so the sparkline ends at the current value.
 */
async function computeDistanceAndHistory(
  anchorAt: number | null,
): Promise<{ distanceM: number; history: HistoryPoint[] }> {
  if (anchorAt === null) return { distanceM: 0, history: [] };
  const track = await activeTrack();
  if (!track || track.points.length === 0) return { distanceM: 0, history: [] };
  const points = track.points;
  const nowS = Date.now() / 1000;
  const totalSpanS = nowS - anchorAt;
  if (totalSpanS <= 0) return { distanceM: 0, history: [] };

  // Pick the smallest bucket width that keeps the series under the cap.
  // 1 h, 2 h, 4 h, 8 h, … doubling.
  let bucketS = HOUR;
  while (totalSpanS / bucketS > MAX_BUCKETS) bucketS *= 2;

  const history: HistoryPoint[] = [];
  for (let t = anchorAt + bucketS; t < nowS; t += bucketS) {
    history.push({ t, cumulativeM: distanceInWindow(points, anchorAt, t) });
  }
  // Always cap the series at the live "now" so the rightmost point matches
  // the displayed total distance.
  history.push({ t: nowS, cumulativeM: distanceInWindow(points, anchorAt, nowS) });

  const distanceM = history[history.length - 1]?.cumulativeM ?? 0;
  return { distanceM, history };
}
