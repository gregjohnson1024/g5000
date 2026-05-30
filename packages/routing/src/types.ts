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
  /** Course over ground (water+current), radians true. Equals heading with
   *  currents off. */
  cog: number;
  /** |TWA| in radians, [0, π]. */
  twa: number;
  /** Tack the leg is sailed on, from the signed TWA (wind on starboard vs
   *  port). Absent on the synthetic start/finish legs. */
  tack?: 'port' | 'starboard';
  /** True when this leg ran under engine — full motor mode, or auto-motor
   *  flooring the polar speed. Drawn as a dashed segment. */
  motoring?: boolean;
  /** TWS in m/s. */
  tws: number;
  /** Through-water boat speed (m/s). */
  bsp: number;
  /** Over-ground speed (m/s). With currents off, equals bsp. */
  sogGround: number;
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
  /** Path-segment index (0 = start→first waypoint) that failed to complete.
   *  Set only when a multi-leg plan (planVia) returns incomplete. */
  incompleteVia?: number;
  /** Captured frontier at each planner step. Present only when
   *  `options.captureIsochrones` is true. */
  isochrones?: Isochrone[];
}

export interface PlanOptions {
  stepMinutes?: number; // default 30
  headingFanDeg?: number; // default 90 (±)
  headingResolutionDeg?: number; // default 5
  maxHours?: number; // default 168
  avoidLand?: boolean; // default true
  useCurrents?: boolean; // default false
  pruneBucketDeg?: number; // default 2
  /** When true, plan() attaches `isochrones` to the returned Route — one
   *  entry per step, holding the pruned frontier at that step's time. */
  captureIsochrones?: boolean; // default false
  /** When true, propagate uses a constant `motorSpeed` for boat speed
   *  through the water instead of looking up the polar. Wind data is still
   *  read (so legs carry tws/twa annotations and we honour the
   *  wind-field bbox), but the polar's wind dependence is bypassed —
   *  matches what a powerboat or a sailboat under engine actually does. */
  motor?: boolean; // default false
  /** Through-water boat speed in m/s when `motor` is true. Ignored
   *  otherwise. */
  motorSpeed?: number; // default 2.572 (5 kn)
  /** Auto-motor: when the polar through-water speed falls below `minSail`
   *  (m/s), substitute `motor` (m/s) for that leg. Evaluated per step because
   *  wind varies along the route. Independent of `motor` (which ignores the
   *  polar entirely). */
  autoMotor?: { minSail: number; motor: number };
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
