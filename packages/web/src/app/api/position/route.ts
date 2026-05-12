import { getSharedBus, type Sample } from '@g5000/core';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * GET /api/position — Server-Sent Events stream of the boat's current
 * position at ~1 Hz.
 *
 * Each event payload: `{ lat, lon, sog, cog, t }` where `t` is seconds
 * since Unix epoch (float). `sog`/`cog` may be `null` if no recent sample
 * has arrived; `lat`/`lon` are guaranteed defined (we don't emit until both
 * are present, so consumers never see a partial fix).
 *
 * Consumed by the Mac router app to drive the live current-position badge
 * and the "reroute from here" UX. Read-only — never publishes to the bus.
 */
export async function GET(): Promise<Response> {
  const bus = getSharedBus();
  const encoder = new TextEncoder();

  // Captured by both start() and cancel() so the consumer aborting the
  // stream tears down subscriptions and the 1 Hz timer.
  const latest: Record<'lat' | 'lon' | 'sog' | 'cog', number | undefined> = {
    lat: undefined,
    lon: undefined,
    sog: undefined,
    cog: undefined,
  };
  const unsubs: Array<() => void> = [];
  let timer: ReturnType<typeof setTimeout> | null = null;
  let closed = false;

  const cleanup = (): void => {
    if (closed) return;
    closed = true;
    if (timer) clearTimeout(timer);
    timer = null;
    for (const u of unsubs) u();
    unsubs.length = 0;
  };

  const stream = new ReadableStream({
    start(controller) {
      const channelMap: Record<string, keyof typeof latest> = {
        'gps.position.lat': 'lat',
        'gps.position.lon': 'lon',
        'gps.position.sog': 'sog',
        'gps.position.cog': 'cog',
      };

      for (const [channel, key] of Object.entries(channelMap)) {
        unsubs.push(
          bus.subscribe(channel, (s: Sample) => {
            if (s.value.kind !== 'scalar') return;
            latest[key] = s.value.value;
          }),
        );
      }

      const emit = (): void => {
        if (closed) return;
        if (latest.lat !== undefined && latest.lon !== undefined) {
          const payload = JSON.stringify({
            lat: latest.lat,
            lon: latest.lon,
            sog: latest.sog ?? null,
            cog: latest.cog ?? null,
            t: Date.now() / 1000,
          });
          try {
            controller.enqueue(encoder.encode(`data: ${payload}\n\n`));
          } catch {
            cleanup();
            return;
          }
        }
        timer = setTimeout(emit, 1000);
      };
      emit();
    },
    cancel() {
      cleanup();
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
