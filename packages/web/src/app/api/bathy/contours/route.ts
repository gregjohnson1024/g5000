import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { ROOT } from '../../../../lib/paths';
import { parseEsriAscii } from '../../../../lib/bathy/esriascii';
import { depthContours } from '../../../../lib/bathy/contours';
import {
  snapBbox,
  cacheKey,
  gmrtUrl,
  type BathyResolution,
  type Bbox,
} from '../../../../lib/bathy/bbox';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const BATHY_CACHE = join(ROOT, 'bathy-cache');
const USER_AGENT = 'g5000-marine-router/1.0 (https://g5000.sulabassana.net)';

// Signed elevations in metres (negative = below sea level).
const THRESHOLDS = [-10, -20, -50, -100, -200, -500, -1000, -2000, -3000, -4000, -5000];

function num(v: string | null): number | null {
  if (v == null) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

export async function GET(req: Request): Promise<Response> {
  const sp = new URL(req.url).searchParams;
  const latMin = num(sp.get('latMin'));
  const latMax = num(sp.get('latMax'));
  const lonMin = num(sp.get('lonMin'));
  const lonMax = num(sp.get('lonMax'));
  if (latMin == null || latMax == null || lonMin == null || lonMax == null) {
    return Response.json({ ok: false, error: { message: 'bbox required' } }, { status: 400 });
  }
  const resRaw = sp.get('res');
  const res: BathyResolution = resRaw === 'high' ? 'high' : 'low';
  const bbox: Bbox = snapBbox({ latMin, latMax, lonMin, lonMax });
  const key = cacheKey(bbox, res);
  const file = join(BATHY_CACHE, `${key}.geojson`);

  // Serve from disk if present (bathymetry is static → no TTL).
  try {
    const cached = await readFile(file, 'utf8');
    return new Response(cached, {
      status: 200,
      headers: { 'content-type': 'application/json', 'x-cache': 'HIT' },
    });
  } catch {
    /* miss — fetch + build below */
  }

  let text: string;
  try {
    const r = await fetch(gmrtUrl(bbox, res), { headers: { 'user-agent': USER_AGENT } });
    if (!r.ok) {
      return Response.json({ ok: false, error: { message: `GMRT ${r.status}` } }, { status: 502 });
    }
    text = await r.text();
  } catch (e) {
    return Response.json({ ok: false, error: { message: String(e) } }, { status: 502 });
  }

  const grid = parseEsriAscii(text);
  const fc = depthContours(grid, THRESHOLDS);
  const body = JSON.stringify(fc);
  // Best-effort cache write; never block the response.
  void mkdir(BATHY_CACHE, { recursive: true })
    .then(() => writeFile(file, body))
    .catch(() => {});
  return new Response(body, {
    status: 200,
    headers: { 'content-type': 'application/json', 'x-cache': 'MISS' },
  });
}
