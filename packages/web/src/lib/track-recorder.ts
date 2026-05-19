import { activeTrack, createTrack, appendPoint, type Track, type TrackPoint } from './tracks';
import { positionStreamUrl } from './g5000-client';

/**
 * Server-side track recorder. Connects to the autopilot-server's
 * `/api/position` SSE feed and appends down-sampled fixes to the currently
 * active track. If there's no active track on startup, one is created.
 *
 * Down-sampling: a fix is appended only when it's at least
 * `MIN_INTERVAL_MS` past the last appended fix AND the boat has moved
 * `MIN_DISTANCE_M` since then (OR `MIN_INTERVAL_MS_FORCE` has elapsed).
 * That keeps multi-day tracks under a few thousand points without losing
 * shape during turns.
 */

const MIN_INTERVAL_MS = 5_000; // never append more often than 5 s
const MIN_DISTANCE_M = 100; // append if moved 100 m since last point
const MIN_INTERVAL_MS_FORCE = 60_000; // … or if a full minute has passed

interface Recorder {
  status: 'starting' | 'running' | 'stopped' | 'errored';
  errorMessage?: string;
  activeTrackId: string | null;
  lastPoint: TrackPoint | null;
  lastAppendedAt: number; // unix ms
  pointsAppended: number;
  stop: () => Promise<void>;
}

declare global {
  // eslint-disable-next-line no-var
  var __g5kTrackRecorder__: Recorder | undefined;
}

function haversineM(a: { lat: number; lon: number }, b: { lat: number; lon: number }): number {
  const R = 6_371_000;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLon = ((b.lon - a.lon) * Math.PI) / 180;
  const φ1 = (a.lat * Math.PI) / 180;
  const φ2 = (b.lat * Math.PI) / 180;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(φ1) * Math.cos(φ2) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

/**
 * Idempotent singleton boot. Safe to call from any API route. Returns the
 * shared recorder.
 */
export function ensureRecorder(): Recorder {
  if (globalThis.__g5kTrackRecorder__) return globalThis.__g5kTrackRecorder__;
  const rec: Recorder = {
    status: 'starting',
    activeTrackId: null,
    lastPoint: null,
    lastAppendedAt: 0,
    pointsAppended: 0,
    stop: async () => {
      stopped = true;
      controllerRef?.abort();
    },
  };
  globalThis.__g5kTrackRecorder__ = rec;

  let stopped = false;
  let controllerRef: AbortController | null = null;

  void (async () => {
    try {
      let track: Track | null = await activeTrack();
      if (!track) track = await createTrack();
      rec.activeTrackId = track.id;
      rec.lastPoint = track.points.at(-1) ?? null;
      rec.status = 'running';

      while (!stopped) {
        const controller = new AbortController();
        controllerRef = controller;
        try {
          const res = await fetch(positionStreamUrl(), {
            signal: controller.signal,
            headers: { accept: 'text/event-stream' },
          });
          if (!res.ok || !res.body) {
            throw new Error(`upstream ${res.status}`);
          }
          const reader = res.body.getReader();
          const decoder = new TextDecoder();
          let buffer = '';
          while (!stopped) {
            const { value, done } = await reader.read();
            if (done) break;
            buffer += decoder.decode(value, { stream: true });
            let nl: number;
            while ((nl = buffer.indexOf('\n\n')) >= 0) {
              const evt = buffer.slice(0, nl);
              buffer = buffer.slice(nl + 2);
              const dataLine = evt.split('\n').find((l) => l.startsWith('data:'));
              if (!dataLine) continue;
              try {
                const p = JSON.parse(dataLine.slice(5).trim()) as {
                  lat?: number;
                  lon?: number;
                  cog?: number | null;
                  sog?: number | null;
                  hdg?: number | null;
                  t?: number;
                };
                if (typeof p.lat !== 'number' || typeof p.lon !== 'number') continue;
                await maybeAppend(rec, {
                  t: typeof p.t === 'number' ? p.t : Date.now() / 1000,
                  lat: p.lat,
                  lon: p.lon,
                  cog: typeof p.cog === 'number' ? p.cog : undefined,
                  sog: typeof p.sog === 'number' ? p.sog : undefined,
                  hdg: typeof p.hdg === 'number' ? p.hdg : undefined,
                });
              } catch {
                /* parse error — skip line */
              }
            }
          }
        } catch (err: unknown) {
          if (stopped) break;
          rec.errorMessage = err instanceof Error ? err.message : String(err);
          // Wait + retry — upstream might be down briefly.
          await new Promise((r) => setTimeout(r, 5_000));
        }
      }
      rec.status = 'stopped';
    } catch (err: unknown) {
      rec.status = 'errored';
      rec.errorMessage = err instanceof Error ? err.message : String(err);
    }
  })();
  return rec;
}

async function maybeAppend(rec: Recorder, pt: TrackPoint): Promise<void> {
  if (!rec.activeTrackId) return;
  const nowMs = Date.now();
  const elapsedMs = nowMs - rec.lastAppendedAt;
  if (elapsedMs < MIN_INTERVAL_MS) return;
  const dist = rec.lastPoint ? haversineM(rec.lastPoint, pt) : Infinity;
  const shouldAppend =
    rec.lastPoint === null || dist >= MIN_DISTANCE_M || elapsedMs >= MIN_INTERVAL_MS_FORCE;
  if (!shouldAppend) return;
  try {
    const updated = await appendPoint(rec.activeTrackId, pt);
    if (updated) {
      rec.lastPoint = pt;
      rec.lastAppendedAt = nowMs;
      rec.pointsAppended += 1;
    }
  } catch (err: unknown) {
    // Track might have been interrupted; reload the active.
    const next = await activeTrack();
    if (next) {
      rec.activeTrackId = next.id;
      rec.lastPoint = next.points.at(-1) ?? null;
    } else {
      rec.errorMessage = err instanceof Error ? err.message : String(err);
    }
  }
}

/** Force the recorder to re-resolve its active track. Call after interrupt. */
export function notifyTrackChange(): void {
  const rec = globalThis.__g5kTrackRecorder__;
  if (!rec) return;
  void activeTrack().then((t) => {
    if (t) {
      rec.activeTrackId = t.id;
      rec.lastPoint = t.points.at(-1) ?? null;
      rec.lastAppendedAt = 0;
    }
  });
}

export function recorderStatus(): {
  status: string;
  activeTrackId: string | null;
  pointsAppended: number;
  lastPoint: TrackPoint | null;
  errorMessage?: string;
} {
  const rec = globalThis.__g5kTrackRecorder__;
  if (!rec)
    return { status: 'not_started', activeTrackId: null, pointsAppended: 0, lastPoint: null };
  return {
    status: rec.status,
    activeTrackId: rec.activeTrackId,
    pointsAppended: rec.pointsAppended,
    lastPoint: rec.lastPoint,
    errorMessage: rec.errorMessage,
  };
}
