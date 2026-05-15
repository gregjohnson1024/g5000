import { pgnFirehose$ } from '@g5000/core';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * GET /api/sniff/pgn?pgn=130850[,...]  — SSE stream of decoded PGNs matching
 * the requested numbers. Used by /sniff to identify which Simnet AP event
 * IDs the Triton keypad emits for each key.
 *
 * The firehose carries everything decoded by the bridge, so filtering
 * client-side would work too — but for autopilot frames at ~2 Hz, a
 * narrow filter here is cheaper.
 */
export async function GET(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const pgnsParam = url.searchParams.get('pgn') ?? '';
  const wanted = new Set(
    pgnsParam
      .split(',')
      .map((s) => Number(s.trim()))
      .filter((n) => Number.isFinite(n) && n > 0),
  );
  if (wanted.size === 0) {
    return Response.json(
      { ok: false, error: { kind: 'bad_request', message: 'missing pgn=… query' } },
      { status: 400 },
    );
  }

  const encoder = new TextEncoder();
  let subscription: { unsubscribe(): void } | null = null;
  let closed = false;

  const stream = new ReadableStream({
    start(controller) {
      subscription = pgnFirehose$().subscribe({
        next: (p) => {
          if (closed) return;
          if (!wanted.has(p.pgn)) return;
          try {
            controller.enqueue(
              encoder.encode(
                `data: ${JSON.stringify({
                  t: Date.now() / 1000,
                  pgn: p.pgn,
                  src: p.src,
                  prio: p.prio,
                  dst: p.dst,
                  fields: p.fields,
                })}\n\n`,
              ),
            );
          } catch {
            cleanup();
          }
        },
        error: () => cleanup(),
      });
    },
    cancel() {
      cleanup();
    },
  });

  function cleanup(): void {
    if (closed) return;
    closed = true;
    subscription?.unsubscribe();
    subscription = null;
  }

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
    },
  });
}
