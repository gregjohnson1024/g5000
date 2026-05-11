import { getLogStream } from '@g5000/core';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * GET /api/logs/stream — Server-Sent Events feed of the server's recent
 * `console.log/warn/error` output. Replays up to the last 500 entries
 * on connect, then streams live entries until the client disconnects.
 */
export async function GET(req: Request): Promise<Response> {
  const ls = getLogStream();
  if (!ls) return new Response('log stream not initialised', { status: 503 });

  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    start(controller) {
      const send = (data: string): void => {
        try {
          controller.enqueue(encoder.encode(`data: ${data}\n\n`));
        } catch {
          /* controller already closed — let the abort handler tidy up */
        }
      };

      // Replay history first so the client sees existing buffer entries.
      for (const e of ls.getRecent(500)) send(JSON.stringify(e));

      const unsub = ls.subscribe((e) => send(JSON.stringify(e)));

      const heartbeat = setInterval(() => {
        try {
          controller.enqueue(encoder.encode(`: heartbeat\n\n`));
        } catch {
          /* ignore */
        }
      }, 15_000);

      req.signal.addEventListener('abort', () => {
        unsub();
        clearInterval(heartbeat);
        try {
          controller.close();
        } catch {
          /* already closed */
        }
      });
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
    },
  });
}
