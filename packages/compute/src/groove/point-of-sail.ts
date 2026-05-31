export type PointOfSail = 'upwind' | 'reaching' | 'downwind' | 'not-sailing';

export interface ClassifyArgs {
  /** |TWA|, radians. */
  twaAbsRad: number;
  /** True wind speed, m/s. */
  twsMs: number;
  /** Boat speed through water, m/s. */
  bspMs: number;
  /** Upwind/reaching boundary, radians. */
  reachingLoRad: number;
  /** Reaching/downwind boundary, radians. */
  reachingHiRad: number;
  /** Below this TWS → not-sailing. */
  twsFloorMs: number;
  /** Below this STW → not-sailing. */
  steerageFloorMs: number;
}

/** Heuristic point-of-sail from |TWA|, gated by wind/steerage floors. */
export function classifyPointOfSail(a: ClassifyArgs): PointOfSail {
  if (a.twsMs < a.twsFloorMs || a.bspMs < a.steerageFloorMs) return 'not-sailing';
  if (a.twaAbsRad < a.reachingLoRad) return 'upwind';
  if (a.twaAbsRad > a.reachingHiRad) return 'downwind';
  return 'reaching';
}
