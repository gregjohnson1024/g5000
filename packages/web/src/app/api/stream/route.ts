import { getSharedBus } from '@h6000/core';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * GET /api/stream — Server-Sent Events feed of every Sample published to
 * the shared bus.
 *
 * Throttling: we batch up to 50 ms of samples per channel and emit at most
 * one update per channel per batch. This caps fan-out to ~20 Hz per channel,
 * which is plenty for a UI inspector.
 */
export async function GET(req: Request): Promise<Response> {
  const bus = getSharedBus();
  const encoder = new TextEncoder();
  const BATCH_MS = 50;

  const stream = new ReadableStream({
    start(controller) {
      const latest = new Map<string, unknown>();
      let flushTimer: ReturnType<typeof setTimeout> | null = null;

      const flush = (): void => {
        flushTimer = null;
        if (latest.size === 0) return;
        for (const [channel, sample] of latest) {
          const payload = JSON.stringify({ channel, sample });
          controller.enqueue(encoder.encode(`data: ${payload}\n\n`));
        }
        latest.clear();
      };

      const unsub = bus.subscribe('**', (sample) => {
        latest.set(sample.channel, sample);
        if (flushTimer === null) flushTimer = setTimeout(flush, BATCH_MS);
      });

      const heartbeat = setInterval(() => {
        controller.enqueue(encoder.encode(`: heartbeat\n\n`));
      }, 15_000);

      // Initial comment so the connection establishes immediately.
      controller.enqueue(encoder.encode(`: connected\n\n`));

      req.signal.addEventListener('abort', () => {
        unsub();
        clearInterval(heartbeat);
        if (flushTimer) clearTimeout(flushTimer);
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
