import { getTrack } from '../../../../../lib/tracks';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * GET /api/tracks/[id]/slice?from=<tsMs>&to=<tsMs>
 *
 * Returns { points, annotations } filtered to the inclusive timestamp
 * range. `from` and `to` are both required Unix ms. Note that
 * TrackPoint.t is in SECONDS but our range is in MS — we compare in ms
 * for parity with the timestamps annotations carry.
 *
 * - 400 when from / to are missing or non-numeric.
 * - 404 when the track id doesn't exist.
 * - 200 with empty arrays when from > to (no client-visible error).
 */
export async function GET(
  req: Request,
  ctx: { params: Promise<{ id: string }> },
): Promise<Response> {
  const url = new URL(req.url);
  const fromStr = url.searchParams.get('from');
  const toStr = url.searchParams.get('to');
  const from = fromStr === null ? NaN : Number(fromStr);
  const to = toStr === null ? NaN : Number(toStr);
  if (!Number.isFinite(from) || !Number.isFinite(to)) {
    return Response.json(
      { error: 'from and to are required and must be Unix ms' },
      { status: 400 },
    );
  }
  const { id } = await ctx.params;
  const t = await getTrack(id);
  if (!t) return Response.json({ error: 'track not found' }, { status: 404 });

  if (from > to) {
    return Response.json({ points: [], annotations: [] });
  }
  // TrackPoint.t is seconds; convert to ms for comparison.
  const points = t.points.filter((p) => {
    const tsMs = p.t * 1000;
    return tsMs >= from && tsMs <= to;
  });
  const annotations = (t.annotations ?? []).filter((a) => a.tsMs >= from && a.tsMs <= to);
  return Response.json({ points, annotations });
}
