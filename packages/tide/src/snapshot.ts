import type { TidalEvent, TideState } from './types.js';
import { heightNow, tideState } from './curve.js';
import { nextEvent } from './next-event.js';

export interface TideSnapshot {
  heightNowM: number | null;
  state: TideState | null;
  next: TidalEvent | null;
}

/** Compose the live tide readout from a sorted event list at `nowMs`. */
export function tideSnapshot(events: ReadonlyArray<TidalEvent>, nowMs: number): TideSnapshot {
  return {
    heightNowM: heightNow(events, nowMs),
    state: tideState(events, nowMs),
    next: nextEvent(events, nowMs),
  };
}
