export interface PlaybackLeg {
  t: number; // unix seconds at start of leg
  lat: number;
  lon: number;
  heading: number; // rad
  cog: number; // rad
  tws: number; // m/s
  bsp: number; // m/s
  sogGround: number; // m/s
}

export interface PlaybackRoute {
  start: number;
  end: number;
  legs: PlaybackLeg[];
}

export interface PlaybackState {
  lat: number;
  lon: number;
  hdg: number;
  cog: number;
  sog: number;
  bsp: number;
  beforeStart: boolean;
  atEnd: boolean;
}

/** Position + active-leg state at wall-clock time `t`. Clamps outside the
 *  route's [start, end]. Position is linearly interpolated between the two
 *  bracketing legs; SOG/COG/HDG/BSP come from the active (earlier) leg. */
export function stateAtTime(route: PlaybackRoute, t: number): PlaybackState {
  const legs = route.legs;
  const first = legs[0]!;
  const last = legs[legs.length - 1]!;
  if (t <= first.t) {
    return {
      lat: first.lat,
      lon: first.lon,
      hdg: first.heading,
      cog: first.cog,
      sog: first.sogGround,
      bsp: first.bsp,
      beforeStart: true,
      atEnd: false,
    };
  }
  if (t >= last.t) {
    return {
      lat: last.lat,
      lon: last.lon,
      hdg: last.heading,
      cog: last.cog,
      sog: last.sogGround,
      bsp: last.bsp,
      beforeStart: false,
      atEnd: true,
    };
  }
  let i = 0;
  for (; i < legs.length - 1; i++) if (t >= legs[i]!.t && t < legs[i + 1]!.t) break;
  const a = legs[i]!;
  const b = legs[i + 1]!;
  const f = (t - a.t) / (b.t - a.t);
  return {
    lat: a.lat + (b.lat - a.lat) * f,
    lon: a.lon + (b.lon - a.lon) * f,
    hdg: a.heading,
    cog: a.cog,
    sog: a.sogGround,
    bsp: a.bsp,
    beforeStart: false,
    atEnd: false,
  };
}

/** Forecast hour (offset from runTime) nearest wall-clock `t`, clamped to the
 *  available hours. */
export function nearestForecastHour(
  runTime: number,
  t: number,
  availableHours: number[],
): number | null {
  if (availableHours.length === 0) return null;
  const target = (t - runTime) / 3600;
  let best = availableHours[0]!;
  let bestD = Math.abs(target - best);
  for (const h of availableHours) {
    const d = Math.abs(target - h);
    if (d < bestD) {
      bestD = d;
      best = h;
    }
  }
  return best;
}
