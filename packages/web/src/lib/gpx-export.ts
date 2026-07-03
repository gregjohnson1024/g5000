/**
 * GPX 1.1 export for saved waypoints and saved routes.
 *
 * Distinct from lib/gpx.ts, which exports a *router output* (@g5000/routing
 * Route) as a <trk>. These functions export the persisted ConfigStore
 * Waypoint/Route types (@g5000/db): waypoints as <wpt>, saved routes as
 * <rte>/<rtept> joined in memory from the route's ordered waypointIds —
 * no weather-router involvement.
 */
import type { Route, Waypoint } from '@g5000/db';

function escapeXml(s: string): string {
  return s.replace(
    /[<>&"']/g,
    (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;' })[c]!,
  );
}

const GPX_OPEN =
  '<?xml version="1.0" encoding="UTF-8"?>\n' +
  '<gpx version="1.1" creator="g5000" xmlns="http://www.topografix.com/GPX/1/1">';

export function waypointsToGpx(waypoints: Waypoint[]): string {
  const wpts = waypoints
    .map((w) => {
      const desc = w.notes ? `\n    <desc>${escapeXml(w.notes)}</desc>` : '';
      return (
        `  <wpt lat="${w.lat}" lon="${w.lon}">\n` +
        `    <name>${escapeXml(w.name)}</name>${desc}\n` +
        `  </wpt>`
      );
    })
    .join('\n');
  return `${GPX_OPEN}\n${wpts}${wpts ? '\n' : ''}</gpx>`;
}

/**
 * Export a saved route as <rte>/<rtept>, resolving the route's ordered
 * waypointIds against the supplied waypoint list. Throws if any id is
 * missing (referential integrity should make that impossible).
 */
export function savedRouteToGpx(route: Route, waypoints: Waypoint[]): string {
  const byId = new Map(waypoints.map((w) => [w.id, w]));
  const rtepts = route.waypointIds
    .map((id) => {
      const w = byId.get(id);
      if (!w) throw new Error(`route "${route.id}" references unknown waypoint id "${id}"`);
      return (
        `    <rtept lat="${w.lat}" lon="${w.lon}">\n` +
        `      <name>${escapeXml(w.name)}</name>\n` +
        `    </rtept>`
      );
    })
    .join('\n');
  const desc = route.notes ? `\n    <desc>${escapeXml(route.notes)}</desc>` : '';
  return (
    `${GPX_OPEN}\n` +
    `  <rte>\n` +
    `    <name>${escapeXml(route.name)}</name>${desc}\n` +
    `${rtepts}${rtepts ? '\n' : ''}` +
    `  </rte>\n` +
    `</gpx>`
  );
}
