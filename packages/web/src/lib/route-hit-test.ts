export interface HitWaypoint {
  id: string;
  name: string;
  lat: number;
  lon: number;
}

export type ContextTarget =
  | { kind: 'empty'; lat: number; lon: number }
  | { kind: 'waypoint'; waypoint: HitWaypoint; inRoute: boolean }
  | { kind: 'leg'; lat: number; lon: number; insertIndex: number };

interface HitFeature {
  layer?: { id?: string };
  properties?: Record<string, unknown> | null;
}

/** Resolve a right-click into a route-editing target. Waypoint markers take
 *  precedence over route legs, which take precedence over empty water. */
export function resolveTarget(
  features: HitFeature[],
  ctx: { lat: number; lon: number; routeIds: string[]; waypointById: Map<string, HitWaypoint> },
): ContextTarget {
  const wpFeat = features.find((f) => f.layer?.id === 'waypoints-dot');
  if (wpFeat) {
    const id = String(wpFeat.properties?.id ?? '');
    const wp = ctx.waypointById.get(id);
    if (wp) return { kind: 'waypoint', waypoint: wp, inRoute: ctx.routeIds.includes(id) };
  }
  const legFeat = features.find((f) => f.layer?.id === 'route-connector');
  if (legFeat) {
    const segIndex = Number(legFeat.properties?.segIndex ?? 0);
    return { kind: 'leg', lat: ctx.lat, lon: ctx.lon, insertIndex: segIndex + 1 };
  }
  return { kind: 'empty', lat: ctx.lat, lon: ctx.lon };
}
