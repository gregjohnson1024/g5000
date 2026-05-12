import type { LatLon, WindField, CurrentField } from '@g5000/grib';
import type { Coastline } from '@g5000/coastline';
import type { PolarTable } from '@g5000/db';

export type { LatLon };

export interface RouteLeg {
  /** Unix seconds at the START of this leg. */
  t: number;
  lat: number;
  lon: number;
  /** Boat's heading (water frame), radians true. */
  heading: number;
  /** |TWA| in radians, [0, π]. */
  twa: number;
  /** TWS in m/s. */
  tws: number;
  /** Through-water boat speed (m/s). */
  bsp: number;
  /** Over-ground speed (m/s). With currents off, equals bsp. */
  sogGround: number;
}

export interface Route {
  legs: RouteLeg[];
  start: number;
  end: number;
  /** Sum of leg over-ground distances (m). */
  distance: number;
  model: WindField['source'];
  usedCurrents: boolean;
  polarId: string;
  incomplete?: boolean;
  reason?: 'exceeded_max_hours' | 'no_wind' | 'land_blocked';
}

export interface PlanOptions {
  stepMinutes?: number;            // default 30
  headingFanDeg?: number;          // default 90 (±)
  headingResolutionDeg?: number;   // default 5
  maxHours?: number;               // default 168
  avoidLand?: boolean;             // default true
  useCurrents?: boolean;           // default false
  pruneBucketDeg?: number;         // default 2
}

export interface PlanInput {
  start: LatLon;
  end: LatLon;
  /** Unix seconds. */
  departure: number;
  wind: WindField;
  polar: PolarTable;
  polarId: string;
  coastline: Coastline;
  currents?: CurrentField;
  options?: PlanOptions;
}
