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
  /** Recommended sail configuration for this leg, from the crossover map.
   *  Absent when no crossover input was provided OR the leg's cell is empty
   *  in the map. */
  configId?: string;
}

export interface Isochrone {
  /** Unix seconds at which this frontier is valid. */
  t: number;
  /** Points on the frontier, sorted by bearing from the start so polyline
   *  rendering joins them in a sensible order. */
  points: LatLon[];
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
  /** Captured frontier at each planner step. Present only when
   *  `options.captureIsochrones` is true. */
  isochrones?: Isochrone[];
}

export interface PlanOptions {
  stepMinutes?: number;            // default 30
  headingFanDeg?: number;          // default 90 (±)
  headingResolutionDeg?: number;   // default 5
  maxHours?: number;               // default 168
  avoidLand?: boolean;             // default true
  useCurrents?: boolean;           // default false
  pruneBucketDeg?: number;         // default 2
  /** When true, plan() attaches `isochrones` to the returned Route — one
   *  entry per step, holding the pruned frontier at that step's time. */
  captureIsochrones?: boolean;     // default false
  /** When true, propagate uses a constant `motorSpeed` for boat speed
   *  through the water instead of looking up the polar. Wind data is still
   *  read (so legs carry tws/twa annotations and we honour the
   *  wind-field bbox), but the polar's wind dependence is bypassed —
   *  matches what a powerboat or a sailboat under engine actually does. */
  motor?: boolean;                 // default false
  /** Through-water boat speed in m/s when `motor` is true. Ignored
   *  otherwise. */
  motorSpeed?: number;             // default 2.572 (5 kn)
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
  /** When set, the planner decorates each leg with the recommended
   *  configId from the crossover map. Has no effect on the route geometry —
   *  polar selection is unchanged (single polar per boat+mode). */
  crossover?: {
    map: import('@g5000/db').CrossoverMap;
    wardrobe: import('@g5000/db').SailWardrobe;
  };
}
