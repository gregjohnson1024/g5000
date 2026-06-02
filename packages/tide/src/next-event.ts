import type { TidalEvent } from './types.js';

/** First event strictly after `nowMs` (events assumed sorted ascending), or null. */
export function nextEvent(events: ReadonlyArray<TidalEvent>, nowMs: number): TidalEvent | null {
  for (const e of events) {
    if (e.timeMs > nowMs) return e;
  }
  return null;
}
