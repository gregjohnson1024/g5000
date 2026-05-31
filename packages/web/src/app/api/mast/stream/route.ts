import { getSharedMastRuntime } from '@g5000/mast';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(req: Request): Promise<Response> {
  const mastRuntime = getSharedMastRuntime();
  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    start(controller) {
      const send = (event: string, data: unknown): void => {
        controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
      };

      // Initial comment so the connection establishes immediately.
      controller.enqueue(encoder.encode(`: connected\n\n`));

      // Initial state on connect.
      send('layout', mastRuntime.getLayout());
      send('override', mastRuntime.getOverride());

      const layoutSub = mastRuntime.layout$.subscribe((l) => send('layout', l));
      const overrideSub = mastRuntime.override$.subscribe((o) => send('override', o));
      const heartbeat = setInterval(() => controller.enqueue(encoder.encode(': ping\n\n')), 15_000);

      req.signal.addEventListener('abort', () => {
        layoutSub.unsubscribe();
        overrideSub.unsubscribe();
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
