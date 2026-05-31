import type { PointOfSail } from './point-of-sail.js';

/** |TWA| − targetTwa. Positive = footing (wider than optimal), negative = pinching. */
export function targetTwaErrorRad(twaAbsRad: number, targetTwaRad: number): number {
  return twaAbsRad - targetTwaRad;
}

/** VMG to/from the wind, m/s. */
export function vmgMs(bspMs: number, twaRad: number): number {
  return bspMs * Math.cos(twaRad);
}

export interface InGrooveArgs {
  pointOfSail: PointOfSail;
  twaAbsRad: number;
  targetTwaRad: number;
  bspMs: number;
  targetSpeedMs: number;
  toleranceRad: number;
  speedFraction: number;
}

/** Instantaneous in-groove test. Null when not-sailing. */
export function isInGroove(a: InGrooveArgs): boolean | null {
  if (a.pointOfSail === 'not-sailing') return null;
  if (a.targetSpeedMs <= 0) return null;
  const fastEnough = a.bspMs >= a.speedFraction * a.targetSpeedMs;
  if (a.pointOfSail === 'reaching') return fastEnough;
  const onAngle = Math.abs(a.twaAbsRad - a.targetTwaRad) <= a.toleranceRad;
  return onAngle && fastEnough;
}

export interface VmgEffArgs {
  pointOfSail: PointOfSail;
  /** Signed TWA, radians. */
  twaRad: number;
  /** Optimal-VMG TWA magnitude, radians. */
  targetTwaRad: number;
  bspMs: number;
  targetSpeedMs: number;
}

/** Point-of-sail-correct VMG efficiency %, clamped to [0,120]. Null when target ≤ 0 or not-sailing. */
export function vmgEfficiencyPct(a: VmgEffArgs): number | null {
  if (a.pointOfSail === 'not-sailing' || a.targetSpeedMs <= 0) return null;
  let pct: number;
  if (a.pointOfSail === 'reaching') {
    pct = (a.bspMs / a.targetSpeedMs) * 100;
  } else {
    const vmgActual = a.bspMs * Math.cos(a.twaRad);
    const vmgTarget = a.targetSpeedMs * Math.cos(a.targetTwaRad);
    if (Math.abs(vmgTarget) < 1e-9) return null;
    pct = (vmgActual / vmgTarget) * 100;
  }
  if (!Number.isFinite(pct)) return null;
  if (pct < 0) return 0;
  if (pct > 120) return 120;
  return pct;
}
