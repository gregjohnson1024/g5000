import { getSharedObservedSources } from '@g5000/core';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * GET → list of recently observed (channel, source) pairs.
 *
 * Query string:
 *   - `windowMs` (default 5000): only return entries seen within this window.
 *
 * Backed by the singleton ObservedSources tracker installed at server boot.
 * If the tracker hasn't been installed yet (process just started), returns
 * an empty list rather than failing — the next poll will succeed.
 */
export async function GET(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const windowMs = Number(url.searchParams.get('windowMs') ?? '5000');
  const tracker = getSharedObservedSources();
  if (!tracker) {
    return Response.json({ entries: [], windowMs });
  }
  // The tracker stores timestamps as bigint; the response uses ms Numbers
  // so the wire format is plain JSON.
  const entries = tracker.recent(windowMs).map((e) => ({
    channel: e.channel,
    source: e.source,
    lastSeenMs: e.lastSeenMs,
    ageMs: e.ageMs,
    lastValue: e.lastValue,
  }));
  return Response.json({ entries, windowMs });
}
