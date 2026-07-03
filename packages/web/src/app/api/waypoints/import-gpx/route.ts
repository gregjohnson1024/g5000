import { parseGpx } from '../../../../lib/gpx-import';
import { createWaypoint, type Waypoint } from '../../../../lib/waypoints';
import { createRoute } from '../../../../lib/routes';
import { slugify } from '../../../../lib/slug';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * Create a waypoint, retrying with `-2`, `-3`, … id suffixes on id
 * collision so re-imports and duplicate names inside one file don't abort
 * the whole import.
 */
async function createWaypointUnique(input: {
  name: string;
  lat: number;
  lon: number;
  notes?: string;
}): Promise<Waypoint> {
  const base = slugify(input.name) || `wp-${Date.now()}`;
  for (let n = 1; n <= 100; n++) {
    try {
      return await createWaypoint({ ...input, id: n === 1 ? base : `${base}-${n}` });
    } catch (e) {
      // Only an id collision is retryable; rethrow real store failures.
      if (!(e instanceof Error && /already exists/.test(e.message))) throw e;
    }
  }
  throw new Error(`could not allocate a unique id for waypoint "${input.name}"`);
}

async function createRouteUnique(name: string, waypointIds: string[]): Promise<void> {
  const base = slugify(name) || `route-${Date.now()}`;
  for (let n = 1; n <= 100; n++) {
    try {
      await createRoute({ name, waypointIds, id: n === 1 ? base : `${base}-${n}` });
      return;
    } catch (e) {
      // Only an id collision is retryable; anything else (e.g. unknown
      // waypoint id) won't be fixed by a different id.
      if (!(e instanceof Error && /already exists/.test(e.message))) throw e;
    }
  }
  throw new Error(`could not allocate a unique id for route "${name}"`);
}

/**
 * POST /api/waypoints/import-gpx — body is raw GPX XML. Imports <wpt> as
 * waypoints; <rte> and <trk> become saved routes whose points are created
 * as waypoints first (routes reference waypoints by id).
 */
export async function POST(req: Request): Promise<Response> {
  let xml: string;
  try {
    xml = await req.text();
  } catch {
    return Response.json({ ok: false, error: { message: 'unreadable body' } }, { status: 400 });
  }
  let parsed;
  try {
    parsed = parseGpx(xml);
  } catch (e) {
    return Response.json(
      { ok: false, error: { message: e instanceof Error ? e.message : String(e) } },
      { status: 422 },
    );
  }
  if (parsed.waypoints.length === 0 && parsed.routes.length === 0) {
    return Response.json(
      { ok: false, error: { message: 'GPX contains no waypoints, routes, or tracks' } },
      { status: 422 },
    );
  }
  try {
    let waypointCount = 0;
    for (const w of parsed.waypoints) {
      await createWaypointUnique({ name: w.name, lat: w.lat, lon: w.lon, notes: w.desc });
      waypointCount++;
    }
    let routeCount = 0;
    for (const r of parsed.routes) {
      const ids: string[] = [];
      for (const [i, p] of r.points.entries()) {
        const pointName = p.name || `${r.name} ${i + 1}`;
        const wp = await createWaypointUnique({ name: pointName, lat: p.lat, lon: p.lon });
        ids.push(wp.id);
        waypointCount++;
      }
      await createRouteUnique(r.name, ids);
      routeCount++;
    }
    return Response.json({
      ok: true,
      imported: { waypoints: waypointCount, routes: routeCount },
    });
  } catch (e) {
    return Response.json(
      { ok: false, error: { message: e instanceof Error ? e.message : String(e) } },
      { status: 500 },
    );
  }
}
