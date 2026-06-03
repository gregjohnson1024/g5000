export interface CurrentPrediction {
  timeMs: number;
  /** Drift — current speed, knots. */
  speedKn: number;
  /** Set — current direction, degrees true [0,360). */
  dirDeg: number;
}

export type CurrentEventKind = 'slack' | 'flood' | 'ebb';

export interface CurrentEvent {
  timeMs: number;
  speedKn: number;
  kind: CurrentEventKind;
}

function bracket(
  preds: ReadonlyArray<CurrentPrediction>,
  nowMs: number,
): [CurrentPrediction, CurrentPrediction] | null {
  for (let i = 0; i < preds.length - 1; i++) {
    if (preds[i]!.timeMs <= nowMs && nowMs <= preds[i + 1]!.timeMs) {
      return [preds[i]!, preds[i + 1]!];
    }
  }
  return null;
}

/** Set & drift at nowMs from the ascending prediction series. Linear speed,
 *  circular direction (wrap-safe across 0/360). Null when no bracketing pair. */
export function currentNow(
  preds: ReadonlyArray<CurrentPrediction>,
  nowMs: number,
): { speedKn: number; dirDeg: number } | null {
  const pair = bracket(preds, nowMs);
  if (!pair) return null;
  const [a, b] = pair;
  const span = b.timeMs - a.timeMs;
  const f = span === 0 ? 0 : (nowMs - a.timeMs) / span;
  const speedKn = a.speedKn + f * (b.speedKn - a.speedKn);
  const ar = (a.dirDeg * Math.PI) / 180;
  const br = (b.dirDeg * Math.PI) / 180;
  const x = (1 - f) * Math.cos(ar) + f * Math.cos(br);
  const y = (1 - f) * Math.sin(ar) + f * Math.sin(br);
  let dirDeg = (Math.atan2(y, x) * 180) / Math.PI;
  dirDeg = ((dirDeg % 360) + 360) % 360;
  return { speedKn, dirDeg };
}

/** First event strictly after nowMs (events assumed ascending), or null. */
export function nextCurrentEvent(
  events: ReadonlyArray<CurrentEvent>,
  nowMs: number,
): CurrentEvent | null {
  for (const e of events) {
    if (e.timeMs > nowMs) return e;
  }
  return null;
}
