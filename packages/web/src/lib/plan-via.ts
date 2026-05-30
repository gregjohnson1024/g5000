export interface WaypointLite {
  id: string;
  lat: number;
  lon: number;
}

export interface SavedRouteLite {
  id: string;
  name: string;
  waypointIds: string[];
}

export interface OrderedPlan {
  start: { lat: number; lon: number };
  end: { lat: number; lon: number };
  via: { lat: number; lon: number }[];
}

/**
 * Resolve a saved route's waypointIds into ordered coordinates, split into
 * start / intermediates (via) / end. Unresolvable ids (deleted waypoints) are
 * skipped. Returns null if fewer than two waypoints resolve.
 */
export function orderedPlanFromRoute(
  route: SavedRouteLite,
  waypoints: WaypointLite[],
): OrderedPlan | null {
  const byId = new Map(waypoints.map((w) => [w.id, w]));
  const pts = route.waypointIds
    .map((id) => byId.get(id))
    .filter((w): w is WaypointLite => w !== undefined);
  if (pts.length < 2) return null;
  return {
    start: { lat: pts[0]!.lat, lon: pts[0]!.lon },
    end: { lat: pts[pts.length - 1]!.lat, lon: pts[pts.length - 1]!.lon },
    via: pts.slice(1, -1).map((w) => ({ lat: w.lat, lon: w.lon })),
  };
}
