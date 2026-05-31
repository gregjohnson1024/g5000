export interface LeewayArgs {
  /** Heel angle, radians (signed; lee positive). */
  heelRad: number;
  /** Boat speed through water, m/s. */
  stwMs: number;
  /** Coefficient k. 0 disables (returns 0). */
  k: number;
  /** Clamp on |leeway|, radians. */
  maxRad: number;
  /** STW floor used in the denominator to avoid low-speed blow-up. */
  stwFloorMs: number;
}

/** Leeway estimate λ = k·heel / max(STW, floor)², clamped to ±maxRad. */
export function leewayRad(a: LeewayArgs): number {
  if (a.k === 0) return 0;
  const stw = Math.max(a.stwMs, a.stwFloorMs);
  const raw = (a.k * a.heelRad) / (stw * stw);
  if (raw > a.maxRad) return a.maxRad;
  if (raw < -a.maxRad) return -a.maxRad;
  return raw;
}
