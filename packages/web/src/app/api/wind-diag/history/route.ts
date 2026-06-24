import { getSharedChannelHistory } from '@g5000/core';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * GET → per-source raw-sample series for the wind-diagnostics view.
 *
 * Query string:
 *   - `windowMs` (default 300000): rolling window of history to return.
 *   - `channels` (optional CSV): restrict to these channels; otherwise the
 *     owner's default set (the seven wind-diagnostic channels).
 *
 * Backed by the singleton ChannelHistory tracker installed at server boot.
 * It carries the undamped, per-(channel, source) bus scalars in SI units
 * (m/s, rad) so the diagnostic can compare every source feeding each channel —
 * unlike `/api/stream`, which winner-selects and EMA-damps. If the tracker
 * hasn't been installed yet (process just started), returns an empty series
 * list rather than failing — the next poll will succeed.
 */
export async function GET(req: Request): Promise<Response> {
  const url = new URL(req.url);
  let windowMs = Number(url.searchParams.get('windowMs') ?? '300000');
  if (!Number.isFinite(windowMs) || windowMs <= 0) windowMs = 300000;
  const channelsParam = url.searchParams.get('channels');
  const channels = channelsParam
    ? channelsParam
        .split(',')
        .map((c) => c.trim())
        .filter((c) => c.length > 0)
    : undefined;
  const tracker = getSharedChannelHistory();
  if (!tracker) {
    return Response.json({ windowMs, series: [] });
  }
  // The snapshot already uses ms Numbers + plain scalars, so it is wire-safe.
  return Response.json(tracker.snapshot(windowMs, channels));
}
