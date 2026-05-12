import type { PlanInput, Route, RouteLeg, PlanOptions, LatLon } from './types.js';
import { interpolateWind, interpolateCurrent } from '@g5000/grib';
import { interpolatePolarSpeed } from '@g5000/compute';
import { intersectsLand } from '@g5000/coastline';
import {
  greatCircleBearing,
  greatCircleDistance,
  rhumbStep,
  normalizeAngle,
  normalizeBearing,
} from './geometry.js';
import { decomposeWind, twaFromWindAndHeading } from './wind.js';
import { generateHeadingFan } from './fan.js';
import { pruneByBearingBucket, type FrontierNode } from './prune.js';

const DEG = Math.PI / 180;

const DEFAULTS: Required<PlanOptions> = {
  stepMinutes: 30,
  headingFanDeg: 90,
  headingResolutionDeg: 5,
  maxHours: 168,
  avoidLand: true,
  useCurrents: false,
  pruneBucketDeg: 2,
};

export function plan(input: PlanInput): Route {
  const o: Required<PlanOptions> = { ...DEFAULTS, ...(input.options ?? {}) };
  const stepSec = o.stepMinutes * 60;
  const maxSec = o.maxHours * 3600;
  const fanRad = o.headingFanDeg * DEG;
  const resRad = o.headingResolutionDeg * DEG;

  const startNode: FrontierNode = {
    pos: input.start,
    t: input.departure,
    parent: null,
    heading: 0,
    twa: 0,
    tws: 0,
    bsp: 0,
    sogGround: 0,
    distFromStart: 0,
  };

  let frontier: FrontierNode[] = [startNode];
  let bestForReason: FrontierNode = startNode;
  let stepCount = 0;
  const maxSteps = Math.ceil(maxSec / stepSec);

  while (stepCount < maxSteps) {
    stepCount++;
    const next: FrontierNode[] = [];
    for (const n of frontier) {
      const bearingToDest = greatCircleBearing(n.pos, input.end);
      const headings = expandFanIfStuck(
        n,
        bearingToDest,
        fanRad,
        resRad,
        input,
        stepSec,
        o,
      );
      for (const h of headings) {
        const child = propagate(n, h, input, stepSec, o);
        if (!child) continue;
        if (o.avoidLand && intersectsLand(
          input.coastline, n.pos.lat, n.pos.lon, child.pos.lat, child.pos.lon,
        )) {
          continue;
        }
        next.push(child);
      }
    }

    if (next.length === 0) {
      return assembleRoute(bestForReason, input, true, 'no_wind');
    }
    frontier = pruneByBearingBucket(next, input.start, o.pruneBucketDeg);

    // Track the best (most progress toward destination) for incomplete return.
    for (const n of frontier) {
      if (
        greatCircleDistance(n.pos, input.end) <
        greatCircleDistance(bestForReason.pos, input.end)
      ) {
        bestForReason = n;
      }
    }

    // Termination: any node within one step's reach of destination → close.
    for (const n of frontier) {
      const dGround = greatCircleDistance(n.pos, input.end);
      if (dGround <= n.sogGround * stepSec || n.sogGround === 0 && dGround === 0) {
        // Synthesize final leg pointing directly at destination.
        const finalHeading = greatCircleBearing(n.pos, input.end);
        const finalTime = n.t + (n.sogGround > 0 ? dGround / n.sogGround : 0);
        const finalLeg: FrontierNode = {
          pos: input.end,
          t: finalTime,
          parent: n,
          heading: finalHeading,
          twa: n.twa,
          tws: n.tws,
          bsp: n.bsp,
          sogGround: n.sogGround,
          distFromStart: n.distFromStart + dGround,
        };
        return assembleRoute(finalLeg, input, false);
      }
    }
  }

  return assembleRoute(bestForReason, input, true, 'exceeded_max_hours');
}

function propagate(
  n: FrontierNode,
  heading: number,
  input: PlanInput,
  stepSec: number,
  o: Required<PlanOptions>,
): FrontierNode | null {
  let wind;
  try {
    wind = interpolateWind(input.wind, n.pos.lat, n.pos.lon, n.t);
  } catch {
    return null; // outside wind field
  }
  const { tws, twd } = decomposeWind(wind.u, wind.v);
  const twa = twaFromWindAndHeading(twd, heading);
  const bsp = interpolatePolarSpeed(input.polar, tws, Math.abs(twa));
  if (bsp < 0.1) return null; // in-irons / no progress

  let vGroundX = Math.sin(heading) * bsp;
  let vGroundY = Math.cos(heading) * bsp;
  if (o.useCurrents && input.currents) {
    try {
      const c = interpolateCurrent(input.currents, n.pos.lat, n.pos.lon, n.t);
      vGroundX += c.u;
      vGroundY += c.v;
    } catch {
      // current data missing here — keep through-water motion
    }
  }
  const sogGround = Math.hypot(vGroundX, vGroundY);
  const groundBearing = Math.atan2(vGroundX, vGroundY);
  const distance = sogGround * stepSec;
  const newPos = rhumbStep(n.pos, distance, groundBearing);

  return {
    pos: newPos,
    t: n.t + stepSec,
    parent: n,
    heading,
    twa: Math.abs(twa),
    tws,
    bsp,
    sogGround,
    distFromStart: n.distFromStart + distance,
  };
}

function expandFanIfStuck(
  n: FrontierNode,
  centerBearing: number,
  fanRad: number,
  resRad: number,
  input: PlanInput,
  stepSec: number,
  o: Required<PlanOptions>,
): number[] {
  // Try the default fan first; if no candidate produces progress, expand.
  for (const width of [fanRad, 1.5 * fanRad, Math.PI]) {
    const headings = generateHeadingFan(centerBearing, width, resRad);
    let anyProgress = false;
    for (const h of headings) {
      const child = propagate(n, h, input, stepSec, o);
      if (child && child.bsp > 0) {
        anyProgress = true;
        break;
      }
    }
    if (anyProgress) return headings;
  }
  return [];
}

function assembleRoute(
  end: FrontierNode,
  input: PlanInput,
  incomplete: boolean,
  reason?: Route['reason'],
): Route {
  const legs: RouteLeg[] = [];
  let cur: FrontierNode | null = end;
  while (cur) {
    legs.push({
      t: cur.t,
      lat: cur.pos.lat,
      lon: cur.pos.lon,
      heading: cur.heading,
      twa: cur.twa,
      tws: cur.tws,
      bsp: cur.bsp,
      sogGround: cur.sogGround,
    });
    cur = cur.parent;
  }
  legs.reverse();
  return {
    legs,
    start: legs[0]!.t,
    end: legs[legs.length - 1]!.t,
    distance: end.distFromStart,
    model: input.wind.source,
    usedCurrents: !!(input.options?.useCurrents && input.currents),
    polarId: input.polarId,
    ...(incomplete ? { incomplete: true } : {}),
    ...(reason ? { reason } : {}),
  };
}
