import type { Route, RouteLeg } from '@g5000/routing';
import { MS_TO_KN, RAD_TO_DEG, wrap360 } from './units';

/** One sample along the route's weather-vs-time series. Values come from the
 *  governing leg (the last leg starting at or before `t`) — the wind the
 *  router believed for that stretch, not a fresh forecast fetch. */
export interface RouteWeatherPoint {
  /** Unix seconds. */
  t: number;
  /** TWS in m/s. */
  tws: number;
  /** |TWA| in degrees, [0, 180]. */
  twaDeg: number;
  /** Through-water boat speed (m/s). */
  bsp: number;
  /** Over-ground speed (m/s). */
  sog: number;
  motoring: boolean;
  lat: number;
  lon: number;
  /** True wind direction (bearing the wind blows FROM, degrees true) derived
   *  from heading + tack-signed TWA. Absent on legs without a tack (the
   *  synthetic start/finish legs), where the sign of TWA is unknown. */
  windDirDeg?: number;
}

export interface RouteWeatherSummary {
  maxTwsKn: number;
  avgTwsKn: number;
  /** Percentage of samples spent motoring, [0, 100]. */
  motoringPct: number;
  /** Route duration in hours. */
  hours: number;
}

export interface RouteWeatherSeries {
  points: RouteWeatherPoint[];
  summary: RouteWeatherSummary;
}

function windDirDeg(leg: RouteLeg): number | undefined {
  if (!leg.tack) return undefined;
  // Starboard tack = wind over the starboard side, i.e. TWD lies |TWA| to
  // starboard of the bow; port tack mirrors it.
  const signed = leg.tack === 'starboard' ? leg.twa : -leg.twa;
  return wrap360((leg.heading + signed) * RAD_TO_DEG);
}

/** Sample the route's legs on a fixed time grid (default 30 min) from start
 *  to end inclusive. No fetches — everything comes from the leg data the
 *  router already computed. */
export function buildRouteWeatherSeries(route: Route, stepS = 1800): RouteWeatherSeries {
  const legs = route.legs;
  const points: RouteWeatherPoint[] = [];
  if (legs.length > 0 && route.end >= route.start) {
    const ts: number[] = [];
    for (let t = route.start; t < route.end; t += stepS) ts.push(t);
    ts.push(route.end);
    let i = 0;
    for (const t of ts) {
      while (i < legs.length - 1 && legs[i + 1]!.t <= t) i++;
      const leg = legs[i]!;
      points.push({
        t,
        tws: leg.tws,
        twaDeg: leg.twa * RAD_TO_DEG,
        bsp: leg.bsp,
        sog: leg.sogGround,
        motoring: leg.motoring === true,
        lat: leg.lat,
        lon: leg.lon,
        windDirDeg: windDirDeg(leg),
      });
    }
  }
  let maxTwsKn = 0;
  let sumTwsKn = 0;
  let motoringCount = 0;
  for (const p of points) {
    const kn = p.tws * MS_TO_KN;
    if (kn > maxTwsKn) maxTwsKn = kn;
    sumTwsKn += kn;
    if (p.motoring) motoringCount++;
  }
  const summary: RouteWeatherSummary = {
    maxTwsKn,
    avgTwsKn: points.length ? sumTwsKn / points.length : 0,
    motoringPct: points.length ? (100 * motoringCount) / points.length : 0,
    hours: points.length ? (route.end - route.start) / 3600 : 0,
  };
  return { points, summary };
}
