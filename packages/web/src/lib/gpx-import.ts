/**
 * Tolerant GPX import: parse <wpt>, <rte>/<rtept> and <trk>/<trkseg>/<trkpt>
 * (tracks are flattened to routes — for import purposes a recorded track is
 * just an ordered list of points).
 *
 * Parsing is delegated to fast-xml-parser; entity decoding and attribute
 * handling come for free. Malformed XML or missing/non-numeric coordinates
 * throw an Error with a message suitable for surfacing straight to the UI.
 */
import { XMLParser, XMLValidator } from 'fast-xml-parser';

export interface GpxWaypoint {
  name: string;
  lat: number;
  lon: number;
  desc?: string;
}

export interface GpxRoutePoint {
  name?: string;
  lat: number;
  lon: number;
}

export interface GpxRoute {
  name: string;
  points: GpxRoutePoint[];
}

export interface ParsedGpx {
  waypoints: GpxWaypoint[];
  routes: GpxRoute[];
}

/** Coerce fast-xml-parser's single-or-array element shape to an array. */
function asArray(v: unknown): unknown[] {
  if (v === undefined || v === null) return [];
  return Array.isArray(v) ? v : [v];
}

/** Extract the text of a child element (string, or object with #text). */
function textOf(v: unknown): string | undefined {
  if (typeof v === 'string') return v;
  if (typeof v === 'number') return String(v);
  if (v && typeof v === 'object' && '#text' in v) {
    const t = (v as Record<string, unknown>)['#text'];
    if (typeof t === 'string') return t;
    if (typeof t === 'number') return String(t);
  }
  return undefined;
}

function coord(el: Record<string, unknown>, attr: 'lat' | 'lon', context: string): number {
  const raw = el[`@_${attr}`];
  const n = typeof raw === 'string' || typeof raw === 'number' ? Number(raw) : NaN;
  const limit = attr === 'lat' ? 90 : 180;
  if (!Number.isFinite(n) || Math.abs(n) > limit) {
    throw new Error(`invalid GPX: ${context} has missing or invalid ${attr} attribute`);
  }
  return n;
}

function parsePoint(v: unknown, context: string): GpxRoutePoint {
  const el = (v ?? {}) as Record<string, unknown>;
  const name = textOf(el.name)?.trim();
  return {
    ...(name ? { name } : {}),
    lat: coord(el, 'lat', context),
    lon: coord(el, 'lon', context),
  };
}

export function parseGpx(xml: string): ParsedGpx {
  const valid = XMLValidator.validate(xml);
  if (valid !== true) {
    throw new Error(`invalid GPX: not well-formed XML (${valid.err.msg})`);
  }
  const parser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: '@_',
    parseTagValue: false,
    parseAttributeValue: false,
    removeNSPrefix: true,
    trimValues: true,
  });
  const doc = parser.parse(xml) as Record<string, unknown>;
  const gpx = doc.gpx;
  if (!gpx || typeof gpx !== 'object') {
    throw new Error('invalid GPX: missing <gpx> root element');
  }
  const root = gpx as Record<string, unknown>;

  const waypoints: GpxWaypoint[] = asArray(root.wpt).map((v, i) => {
    const el = (v ?? {}) as Record<string, unknown>;
    const desc = textOf(el.desc)?.trim();
    return {
      name: textOf(el.name)?.trim() || `Waypoint ${i + 1}`,
      lat: coord(el, 'lat', `<wpt> ${i + 1}`),
      lon: coord(el, 'lon', `<wpt> ${i + 1}`),
      ...(desc ? { desc } : {}),
    };
  });

  const routes: GpxRoute[] = asArray(root.rte).map((v, i) => {
    const el = (v ?? {}) as Record<string, unknown>;
    return {
      name: textOf(el.name)?.trim() || `Route ${i + 1}`,
      points: asArray(el.rtept).map((p, j) => parsePoint(p, `<rtept> ${j + 1} of route ${i + 1}`)),
    };
  });

  // Tracks flatten to routes: every <trkpt> across all <trkseg>s, in order.
  const tracks: GpxRoute[] = asArray(root.trk).map((v, i) => {
    const el = (v ?? {}) as Record<string, unknown>;
    const points = asArray(el.trkseg).flatMap((seg, s) =>
      asArray(((seg ?? {}) as Record<string, unknown>).trkpt).map((p, j) =>
        parsePoint(p, `<trkpt> ${j + 1} of segment ${s + 1}, track ${i + 1}`),
      ),
    );
    return { name: textOf(el.name)?.trim() || `Track ${i + 1}`, points };
  });

  return { waypoints, routes: [...routes, ...tracks] };
}
