import type { PlanInput, Route, RouteLeg, LatLon } from './types.js';
import { plan } from './plan.js';

// Keep in sync with plan.ts DEFAULTS.maxHours — planVia seeds its shared budget
// from the same default the single-leg planner uses.
const PLANNER_DEFAULT_MAX_HOURS = 168;

/**
 * Plan a path through an ordered list of intermediate waypoints. The full path
 * is [input.start, ...intermediates, input.end]. Each consecutive pair is an
 * independent plan() call; the next segment departs at the previous segment's
 * arrival ETA. Legs are concatenated, dropping the duplicated waypoint vertex
 * between segments. `maxHours` is a TOTAL budget shared across segments.
 *
 * Budget is enforced at step granularity, so total elapsed time may overrun
 * maxHours by up to one step (stepMinutes).
 *
 * planVia(input, []) is identical to plan(input).
 */
export function planVia(input: PlanInput, intermediates: LatLon[]): Route {
  if (intermediates.length === 0) return plan(input);

  const path: LatLon[] = [input.start, ...intermediates, input.end];
  const totalMaxHours = input.options?.maxHours ?? PLANNER_DEFAULT_MAX_HOURS;

  const legs: RouteLeg[] = [];
  let distance = 0;
  let departure = input.departure;
  let remainingHours = totalMaxHours;

  for (let i = 0; i < path.length - 1; i++) {
    const seg = plan({
      ...input,
      start: path[i]!,
      end: path[i + 1]!,
      departure,
      // Per-segment isochrone capture is meaningless for a multi-leg route.
      options: { ...input.options, maxHours: remainingHours, captureIsochrones: false },
    });

    // Drop the duplicated vertex: segment i>0's first leg is the synthetic
    // start node sitting on the previous segment's final waypoint.
    legs.push(...(i === 0 ? seg.legs : seg.legs.slice(1)));
    distance += seg.distance;

    if (seg.incomplete) {
      return {
        legs,
        start: input.departure,
        end: legs[legs.length - 1]!.t,
        distance,
        model: seg.model,
        usedCurrents: seg.usedCurrents,
        polarId: seg.polarId,
        incomplete: true,
        ...(seg.reason ? { reason: seg.reason } : {}),
        incompleteVia: i,
      };
    }

    departure = seg.end;
    remainingHours -= (seg.end - seg.start) / 3600;
  }

  return {
    legs,
    start: input.departure,
    end: legs[legs.length - 1]!.t,
    distance,
    model: input.wind.source,
    usedCurrents: !!(input.options?.useCurrents && input.currents),
    polarId: input.polarId,
  };
}
