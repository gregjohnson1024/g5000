import type { PlanInput, Route, RouteLeg, PlanOptions, LatLon, Isochrone } from './types.js';
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
  captureIsochrones: false,
  motor: false,
  motorSpeed: 2.572, // 5 kn in m/s
  autoMotor: undefined as unknown as { minSail: number; motor: number },
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
    cog: 0,
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
  const isochrones: Isochrone[] = o.captureIsochrones ? [] : [];

  while (stepCount < maxSteps) {
    stepCount++;
    const next: FrontierNode[] = [];
    for (const n of frontier) {
      const bearingToDest = greatCircleBearing(n.pos, input.end);
      const headings = expandFanIfStuck(n, bearingToDest, fanRad, resRad, input, stepSec, o);
      for (const h of headings) {
        const child = propagate(n, h, input, stepSec, o);
        if (!child) continue;
        if (
          o.avoidLand &&
          intersectsLand(input.coastline, n.pos.lat, n.pos.lon, child.pos.lat, child.pos.lon)
        ) {
          continue;
        }
        next.push(child);
      }
    }

    if (next.length === 0) {
      return assembleRoute(bestForReason, input, isochrones, true, 'no_wind');
    }
    frontier = pruneByBearingBucket(next, input.start, input.end, o.pruneBucketDeg);

    if (o.captureIsochrones && frontier.length > 0) {
      // Sort by bearing from start so the resulting polyline traces the
      // frontier in angular order rather than insertion order.
      const sorted = [...frontier].sort((a, b) => {
        const ba = Math.atan2(a.pos.lon - input.start.lon, a.pos.lat - input.start.lat);
        const bb = Math.atan2(b.pos.lon - input.start.lon, b.pos.lat - input.start.lat);
        return ba - bb;
      });
      isochrones.push({
        t: frontier[0]!.t,
        points: sorted.map((n) => ({ lat: n.pos.lat, lon: n.pos.lon })),
      });
    }

    // Track the best (most progress toward destination) for incomplete return.
    for (const n of frontier) {
      if (
        greatCircleDistance(n.pos, input.end) < greatCircleDistance(bestForReason.pos, input.end)
      ) {
        bestForReason = n;
      }
    }

    // Termination: any node within one step's reach of destination → close.
    for (const n of frontier) {
      const dGround = greatCircleDistance(n.pos, input.end);
      if (dGround <= n.sogGround * stepSec || (n.sogGround === 0 && dGround === 0)) {
        // Synthesize final leg pointing directly at destination.
        const finalHeading = greatCircleBearing(n.pos, input.end);
        const finalTime = n.t + (n.sogGround > 0 ? dGround / n.sogGround : 0);
        const finalLeg: FrontierNode = {
          pos: input.end,
          t: finalTime,
          parent: n,
          heading: finalHeading,
          cog: finalHeading,
          twa: n.twa,
          tack: n.tack,
          motoring: n.motoring,
          tws: n.tws,
          bsp: n.bsp,
          sogGround: n.sogGround,
          distFromStart: n.distFromStart + dGround,
        };
        return assembleRoute(finalLeg, input, isochrones, false);
      }
    }
  }

  return assembleRoute(bestForReason, input, isochrones, true, 'exceeded_max_hours');
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
  // Motor mode bypasses the polar — engine doesn't care about TWA. Wind
  // data is still read above so legs carry tws/twa for display and the
  // wind-field bbox still gates the planner's reach.
  const bspRaw = o.motor ? o.motorSpeed : interpolatePolarSpeed(input.polar, tws, Math.abs(twa));
  const autoMotored = !!o.autoMotor && bspRaw < o.autoMotor.minSail;
  const bsp = autoMotored ? o.autoMotor!.motor : bspRaw;
  const motoring = o.motor || autoMotored;
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
    cog: groundBearing,
    twa: Math.abs(twa),
    tack: twa >= 0 ? 'starboard' : 'port',
    motoring,
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
  isochrones: Isochrone[],
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
      cog: cur.cog,
      twa: cur.twa,
      tack: cur.tack,
      motoring: cur.motoring,
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
    ...(isochrones.length > 0 ? { isochrones } : {}),
  };
}
