import {
  getSharedBus,
  findRuleForChannel,
  pickWinner,
  type Sample,
  type SourceSnapshot,
  type SourcePriorityConfig,
} from '@g5000/core';
import { getSharedConfigStore } from '@g5000/db';

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
  const configStore = getSharedConfigStore();
  const encoder = new TextEncoder();

  // Apply source-priority rules so a blocked source (or non-winning source)
  // never sneaks into our derived position/HDG. The /api/stream feed has
  // the same logic — keeping them in lockstep means /helm and /chart see
  // the same selected sources.
  let currentRules: SourcePriorityConfig = [];
  const ruleSub = configStore.sourcePriority$.subscribe((r) => {
    currentRules = r;
  });
  const sourceTimes = new Map<string, Map<string, bigint>>();
  const acceptSample = (s: Sample): boolean => {
    let perSource = sourceTimes.get(s.channel);
    if (!perSource) {
      perSource = new Map();
      sourceTimes.set(s.channel, perSource);
    }
    perSource.set(s.source, s.t_ns);
    const rule = findRuleForChannel(currentRules, s.channel);
    if (!rule) return true;
    const snapshots = new Map<string, SourceSnapshot>();
    for (const [src, t_ns] of perSource) snapshots.set(src, { t_ns });
    const winner = pickWinner(rule, snapshots, s.t_ns);
    return winner !== null && winner === s.source;
  };

  // Captured by both start() and cancel() so the consumer aborting the
  // stream tears down subscriptions and the 1 Hz timer.
  const latest: Record<'lat' | 'lon' | 'sog' | 'cog' | 'hdg', number | undefined> = {
    lat: undefined,
    lon: undefined,
    sog: undefined,
    cog: undefined,
    hdg: undefined,
  };
  // Magnetic variation, used to derive true heading when only magnetic is
  // published. East-positive (NMEA 2000 convention); True = Mag + Var.
  let magVar: number | undefined = undefined;
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
    ruleSub.unsubscribe();
  };

  const stream = new ReadableStream({
    start(controller) {
      // Position is `nav.gps.position` (kind: 'geo' with { lat, lon }).
      // COG / SOG are scalars on `nav.gps.cog` / `nav.gps.sog`. (The earlier
      // `gps.position.{lat,lon,...}` flat-scalar layout was replaced when
      // the channel-mapper landed.)
      unsubs.push(
        bus.subscribe('nav.gps.position', (s: Sample) => {
          if (s.value.kind !== 'geo' || !acceptSample(s)) return;
          latest.lat = s.value.value.lat;
          latest.lon = s.value.value.lon;
        }),
      );
      unsubs.push(
        bus.subscribe('nav.gps.cog', (s: Sample) => {
          if (s.value.kind !== 'scalar' || !acceptSample(s)) return;
          latest.cog = s.value.value;
        }),
      );
      unsubs.push(
        bus.subscribe('nav.gps.sog', (s: Sample) => {
          if (s.value.kind !== 'scalar' || !acceptSample(s)) return;
          latest.sog = s.value.value;
        }),
      );
      // Heading: prefer the device-published true heading; otherwise
      // derive true from magnetic + live magnetic variation.
      let lastHdgTrue: number | undefined;
      let lastHdgMag: number | undefined;
      const recomputeHdg = (): void => {
        if (lastHdgTrue !== undefined) {
          latest.hdg = lastHdgTrue;
        } else if (lastHdgMag !== undefined && magVar !== undefined) {
          latest.hdg = lastHdgMag + magVar;
        } else if (lastHdgMag !== undefined) {
          latest.hdg = lastHdgMag;
        }
      };
      unsubs.push(
        bus.subscribe('boat.heading.true', (s: Sample) => {
          if (s.value.kind !== 'scalar' || !acceptSample(s)) return;
          lastHdgTrue = s.value.value;
          recomputeHdg();
        }),
      );
      unsubs.push(
        bus.subscribe('boat.heading.magnetic', (s: Sample) => {
          if (s.value.kind !== 'scalar' || !acceptSample(s)) return;
          lastHdgMag = s.value.value;
          recomputeHdg();
        }),
      );
      unsubs.push(
        bus.subscribe('nav.magvar', (s: Sample) => {
          if (s.value.kind !== 'scalar' || !acceptSample(s)) return;
          magVar = s.value.value;
          recomputeHdg();
        }),
      );

      const emit = (): void => {
        if (closed) return;
        if (latest.lat !== undefined && latest.lon !== undefined) {
          const payload = JSON.stringify({
            lat: latest.lat,
            lon: latest.lon,
            sog: latest.sog ?? null,
            cog: latest.cog ?? null,
            hdg: latest.hdg ?? null,
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
