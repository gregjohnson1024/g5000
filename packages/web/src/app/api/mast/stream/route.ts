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
      send('brightness', mastRuntime.getBrightness());
      send('nightmode', mastRuntime.getNightMode());
      send('daybasecolor', mastRuntime.getDayBaseColor());
      send('daycanvas', mastRuntime.getDayCanvas());
      // Build identity, so a page that has been open across a deploy can notice
      // its bundle is stale and reload. Sent once per connection: the value
      // cannot change without the server restarting, which drops the stream.
      send('buildid', process.env.NEXT_PUBLIC_BUILD_ID ?? null);
      send('theme', mastRuntime.getTheme());
      send('scale', mastRuntime.getScale());
      send('clock', mastRuntime.getClock());

      const layoutSub = mastRuntime.layout$.subscribe((l) => send('layout', l));
      const overrideSub = mastRuntime.override$.subscribe((o) => send('override', o));
      const brightnessSub = mastRuntime.brightness$.subscribe((b) => send('brightness', b));
      const nightModeSub = mastRuntime.nightMode$.subscribe((n) => send('nightmode', n));
      const dayBaseColorSub = mastRuntime.dayBaseColor$.subscribe((c) => send('daybasecolor', c));
      const dayCanvasSub = mastRuntime.dayCanvas$.subscribe((c) => send('daycanvas', c));
      const themeSub = mastRuntime.theme$.subscribe((t) => send('theme', t));
      const scaleSub = mastRuntime.scale$.subscribe((s) => send('scale', s));
      const clockSub = mastRuntime.clock$.subscribe((c) => send('clock', c));
      const heartbeat = setInterval(() => controller.enqueue(encoder.encode(': ping\n\n')), 15_000);

      req.signal.addEventListener('abort', () => {
        layoutSub.unsubscribe();
        overrideSub.unsubscribe();
        brightnessSub.unsubscribe();
        nightModeSub.unsubscribe();
        dayBaseColorSub.unsubscribe();
        dayCanvasSub.unsubscribe();
        themeSub.unsubscribe();
        scaleSub.unsubscribe();
        clockSub.unsubscribe();
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
