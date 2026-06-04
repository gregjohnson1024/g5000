import {
  tideSnapshot,
  currentNow,
  nextCurrentEvent,
  type TidalEvent,
  type TideState,
  type CurrentPrediction,
  type CurrentEvent,
  type CurrentEventKind,
} from '@g5000/tide';

/** Set/drift now (direction normalized to [0,360)) plus the next current event. */
export interface CurrentSummary {
  speedKn: number;
  dirDeg: number;
  next: CurrentEvent | null;
}

/** Height-now (m above CD) plus tide state and the next HW/LW. */
export interface TideSummary {
  heightNowM: number;
  state: TideState | null;
  next: TidalEvent | null;
}

export const CURRENT_KIND_LABEL: Record<CurrentEventKind, string> = {
  slack: 'Slack',
  flood: 'Max flood',
  ebb: 'Max ebb',
};

/** 3-digit zero-padded compass string, wrap-safe across 0/360 ("054°"). */
export function fmtSetDeg(dirDeg: number): string {
  const norm = ((Math.round(dirDeg) % 360) + 360) % 360;
  return String(norm).padStart(3, '0') + '°';
}

/** Compose the current-station popup summary, or null when un-interpolatable. */
export function summarizeCurrent(
  preds: ReadonlyArray<CurrentPrediction>,
  events: ReadonlyArray<CurrentEvent>,
  nowMs: number,
): CurrentSummary | null {
  const now = currentNow(preds, nowMs);
  if (!now) return null;
  const dirDeg = ((now.dirDeg % 360) + 360) % 360;
  return { speedKn: now.speedKn, dirDeg, next: nextCurrentEvent(events, nowMs) };
}

/** Compose the tide-station popup summary, or null when outside the curve window. */
export function summarizeTide(
  events: ReadonlyArray<TidalEvent>,
  nowMs: number,
): TideSummary | null {
  const snap = tideSnapshot(events, nowMs);
  if (snap.heightNowM == null) return null;
  return { heightNowM: snap.heightNowM, state: snap.state, next: snap.next };
}
