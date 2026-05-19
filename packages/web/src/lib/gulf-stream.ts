import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';

const NORTH_WALL_URL = 'https://www.ncei.noaa.gov/jag/navy/data/satellite_analysis/gsnw.mrf';

const G5000_ROUTER_ROOT = process.env.G5000_ROUTER_ROOT ?? path.join(os.homedir(), '.g5000-router');

const CACHE_DIR = path.join(G5000_ROUTER_ROOT, 'gulf-stream');
const NORTH_WALL_CACHE = path.join(CACHE_DIR, 'north-wall.json');

const MAX_AGE_MS = 6 * 60 * 60 * 1000; // 6 h — NOAA updates daily; this is plenty fresh

export interface GulfStreamPayload {
  /** GeoJSON FeatureCollection with one LineString feature. Coordinates are [lon, lat]. */
  geojson: {
    type: 'FeatureCollection';
    features: Array<{
      type: 'Feature';
      properties: { name: string; source: string };
      geometry: { type: 'LineString'; coordinates: [number, number][] };
    }>;
  };
  /** UNIX ms when we last fetched from NOAA (NOT the model run time). */
  fetchedAt: number;
}

/**
 * Parse a Navy .mrf file (plain text). Despite the filename, gsnw.mrf
 * actually contains BOTH walls separated by section headers:
 *
 *   RMKS/1. GULF STREAM NORTH WALL DATA FOR 13 MAY 26:
 *    25.5N80.1W 25.7N80.1W ...
 *   ...
 *   GULF STREAM SOUTH WALL DATA FOR 13 MAY 26:
 *    27.9N78.9W ...
 *
 * Each section becomes its own LineString feature so MapLibre doesn't
 * draw a phantom segment connecting the end of one wall to the start
 * of the next.
 */
export function parseGulfStreamMrf(text: string): GulfStreamPayload['geojson'] {
  // Find section headers; everything between two headers (or between a
  // header and the trailing narrative) is one feature's coord list.
  const headerRe = /GULF STREAM\s+(NORTH|SOUTH)\s+WALL\s+DATA/gi;
  const headers: { name: string; offset: number }[] = [];
  for (const m of text.matchAll(headerRe)) {
    headers.push({
      name: `Gulf Stream — ${m[1]!.charAt(0) + m[1]!.slice(1).toLowerCase()} Wall`,
      offset: m.index! + m[0].length,
    });
  }
  if (headers.length === 0) {
    throw new Error('parseGulfStreamMrf: no section headers found');
  }

  const tokenRe = /(\d+(?:\.\d+)?)N(\d+(?:\.\d+)?)W/g;
  const features: GulfStreamPayload['geojson']['features'] = [];

  for (let i = 0; i < headers.length; i++) {
    const start = headers[i]!.offset;
    const end = i + 1 < headers.length ? headers[i + 1]!.offset : text.length;
    const segment = text.slice(start, end);
    const coords: [number, number][] = [];
    for (const m of segment.matchAll(tokenRe)) {
      const lat = parseFloat(m[1]!);
      const lon = -parseFloat(m[2]!);
      if (Number.isFinite(lat) && Number.isFinite(lon)) coords.push([lon, lat]);
    }
    if (coords.length < 2) continue;
    features.push({
      type: 'Feature',
      properties: { name: headers[i]!.name, source: NORTH_WALL_URL },
      geometry: { type: 'LineString', coordinates: coords },
    });
  }

  if (features.length === 0) {
    throw new Error('parseGulfStreamMrf: no coordinate segments parsed');
  }
  return { type: 'FeatureCollection', features };
}

async function readCacheIfFresh(): Promise<GulfStreamPayload | null> {
  try {
    const stat = await fs.stat(NORTH_WALL_CACHE);
    if (Date.now() - stat.mtimeMs > MAX_AGE_MS) return null;
    const raw = await fs.readFile(NORTH_WALL_CACHE, 'utf8');
    return JSON.parse(raw) as GulfStreamPayload;
  } catch {
    return null;
  }
}

async function writeCache(payload: GulfStreamPayload): Promise<void> {
  await fs.mkdir(CACHE_DIR, { recursive: true });
  await fs.writeFile(NORTH_WALL_CACHE, JSON.stringify(payload));
}

/**
 * Returns the latest Gulf Stream north wall as GeoJSON. Uses an on-disk
 * cache under ~/.g5000-router/gulf-stream/; refetches from NOAA when the
 * cache is older than 6 h or missing. Throws on network error if cache
 * is also unavailable.
 */
export async function getGulfStreamNorthWall(): Promise<GulfStreamPayload> {
  const cached = await readCacheIfFresh();
  if (cached) return cached;

  let mrfText: string;
  try {
    const res = await fetch(NORTH_WALL_URL, { signal: AbortSignal.timeout(15_000) });
    if (!res.ok) throw new Error(`upstream HTTP ${res.status}`);
    mrfText = await res.text();
  } catch (err) {
    // Network failed — fall back to stale cache if any.
    try {
      const raw = await fs.readFile(NORTH_WALL_CACHE, 'utf8');
      return JSON.parse(raw) as GulfStreamPayload;
    } catch {
      throw err;
    }
  }
  const geojson = parseGulfStreamMrf(mrfText);
  const payload: GulfStreamPayload = { geojson, fetchedAt: Date.now() };
  await writeCache(payload);
  return payload;
}
