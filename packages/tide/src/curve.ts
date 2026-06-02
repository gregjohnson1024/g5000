import type { TidalEvent, TideState } from './types.js';

/** Piecewise-cosine tide height between two events. Valid for tA ≤ t ≤ tB,
 *  either rising (hB>hA) or falling (hB<hA). */
export function interpolateHeight(
  tA: number,
  hA: number,
  tB: number,
  hB: number,
  t: number,
): number {
  if (tB === tA) return hA;
  const phase = (Math.PI * (t - tA)) / (tB - tA);
  return (hA + hB) / 2 + ((hA - hB) / 2) * Math.cos(phase);
}

/** Find the consecutive event pair bracketing `nowMs` (tA ≤ now < tB).
 *  Assumes `events` is sorted ascending by timeMs. */
function bracket(events: ReadonlyArray<TidalEvent>, nowMs: number): [TidalEvent, TidalEvent] | null {
  for (let i = 0; i < events.length - 1; i++) {
    if (events[i]!.timeMs <= nowMs && nowMs < events[i + 1]!.timeMs) {
      return [events[i]!, events[i + 1]!];
    }
  }
  return null;
}

/** Interpolated height (m above CD) at `nowMs`, or null when no bracketing pair. */
export function heightNow(events: ReadonlyArray<TidalEvent>, nowMs: number): number | null {
  const pair = bracket(events, nowMs);
  if (!pair) return null;
  const [a, b] = pair;
  return interpolateHeight(a.timeMs, a.heightM, b.timeMs, b.heightM, nowMs);
}

/** rising | falling | stand for `nowMs`, or null when no bracketing pair.
 *  `stand` when within `standWindowMs` of either bracketing event (dh/dt≈0). */
export function tideState(
  events: ReadonlyArray<TidalEvent>,
  nowMs: number,
  standWindowMs = 20 * 60_000,
): TideState | null {
  const pair = bracket(events, nowMs);
  if (!pair) return null;
  const [a, b] = pair;
  if (nowMs - a.timeMs <= standWindowMs || b.timeMs - nowMs <= standWindowMs) return 'stand';
  return b.heightM > a.heightM ? 'rising' : 'falling';
}
