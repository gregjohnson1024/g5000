import type { BoatMode, MastLayout } from './types.js';

/** SOG below this (m/s ≈ 0.5 kn) is treated as stationary. */
export const STATIONARY_SOG_MS = 0.26;
/** |TWA| at or below this (deg) is upwind. */
export const UPWIND_MAX_DEG = 70;
/** |TWA| at or above this (deg) is downwind. The 70–110 gap is "reach" (dead-band). */
export const DOWNWIND_MIN_DEG = 110;

export interface ModeInputs {
  /** True wind angle in radians, or null if unavailable. */
  twaRad: number | null;
  /** Speed over ground in m/s, or null if unavailable. */
  sogMs: number | null;
  engineRunning: boolean;
}

export function evaluateMode({ twaRad, sogMs, engineRunning }: ModeInputs): BoatMode {
  if (engineRunning) return 'delivery';
  if (sogMs === null || sogMs < STATIONARY_SOG_MS) return 'stationary';
  if (twaRad === null) return 'reach';
  const twaDeg = Math.abs((twaRad * 180) / Math.PI);
  if (twaDeg <= UPWIND_MAX_DEG) return 'upwind';
  if (twaDeg >= DOWNWIND_MIN_DEG) return 'downwind';
  return 'reach';
}

/** Pick the active page id: override (if it names a real page) → mode match → always page → first page. */
export function selectActivePage(layout: MastLayout, mode: BoatMode, override: string | null): string | null {
  if (override && layout.pages.some((p) => p.id === override)) return override;
  const byMode = layout.pages.find((p) => p.condition && 'mode' in p.condition && p.condition.mode === mode);
  if (byMode) return byMode.id;
  const always = layout.pages.find((p) => p.condition && 'always' in p.condition);
  if (always) return always.id;
  return layout.pages[0]?.id ?? null;
}
