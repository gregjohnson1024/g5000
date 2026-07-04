import type { LatLon } from './station-distance';

/**
 * One-shot boat fix for pages that only need "where are we right now".
 *
 * There is no plain-JSON position endpoint — `/api/position` is an SSE stream
 * (the same one LiveBoatMarker consumes long-lived) and `/api/stats/eta` 503s
 * without an active track — so the cheapest reliable read is the stream's
 * first event, then close. Resolves null on error or when no fix arrives
 * within `timeoutMs` (the stream emits nothing until lat/lon are known), so
 * callers degrade gracefully to distance-less rendering.
 */
export function fetchBoatFix(timeoutMs = 5000): Promise<LatLon | null> {
  if (typeof EventSource === 'undefined') return Promise.resolve(null);
  return new Promise((resolve) => {
    let settled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const es = new EventSource('/api/position');
    const finish = (v: LatLon | null): void => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      es.close();
      resolve(v);
    };
    timer = setTimeout(() => finish(null), timeoutMs);
    es.onmessage = (ev) => {
      try {
        const j = JSON.parse(ev.data as string) as { lat?: unknown; lon?: unknown };
        if (typeof j.lat === 'number' && typeof j.lon === 'number') {
          finish({ lat: j.lat, lon: j.lon });
        } else {
          finish(null);
        }
      } catch {
        finish(null);
      }
    };
    es.onerror = () => finish(null);
  });
}
