import { mkdir, readFile, writeFile, stat } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { ROOT } from '../../../../../../lib/paths';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * On-disk NOAA NCDS chart tile cache.
 *
 * Mounted at /api/enc-tiles/{z}/{x}/{y}(.png) so the chart's maplibre
 * source can point at a same-origin URL. The browser sends standard
 * XYZ coordinates; we translate to NOAA's ArcGIS conventions:
 *
 *   - NOAA's z=0 is 1/4 the resolution of standard XYZ z=0, so
 *     `noaa_z = standard_z - 2`. NOAA covers noaa_z=0..16, i.e.
 *     standard_z=2..18. Outside that band we serve a transparent
 *     1x1 PNG (status 200, x-cache=EMPTY) to keep MapLibre quiet.
 *
 *   - ArcGIS uses `/tile/{z}/{row}/{col}` — i.e. y BEFORE x — so the
 *     upstream URL swaps the order of our incoming {x}/{y} params.
 *
 * Cache location: `${G5000_ROUTER_ROOT}/enc-cache/{z}/{x}/{y}.png`
 * using the standard XYZ coords (so cache keys match MapLibre's
 * requests one-to-one). Defaults to `~/.g5000-router/enc-cache`.
 *
 * NOAA NCDS data is public domain. Attribution is provided via the
 * MapLibre source's `attribution` property in `EncLayer.tsx`.
 */

const ENC_CACHE_ROOT = join(ROOT, 'enc-cache');
const MAX_AGE_MS = 30 * 24 * 3600 * 1000; // 30 days
const USER_AGENT = 'g5000-marine-router/1.0 (https://g5000.sulabassana.net)';

const MIN_Z = 2;
const MAX_Z = 18;

// Minimal 1x1 fully-transparent PNG (67 bytes). Pre-encoded as a
// constant so we never re-encode at request time.
const TRANSPARENT_PNG = new Uint8Array([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d,
  0x49, 0x48, 0x44, 0x52, 0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01,
  0x08, 0x06, 0x00, 0x00, 0x00, 0x1f, 0x15, 0xc4, 0x89, 0x00, 0x00, 0x00,
  0x0d, 0x49, 0x44, 0x41, 0x54, 0x78, 0x9c, 0x63, 0x00, 0x01, 0x00, 0x00,
  0x05, 0x00, 0x01, 0x0d, 0x0a, 0x2d, 0xb4, 0x00, 0x00, 0x00, 0x00, 0x49,
  0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82,
]);

function tilePath(z: string, x: string, y: string): string {
  // Strip any `.png` suffix Next.js might pass through, then re-add.
  const yBase = y.replace(/\.png$/, '');
  return join(ENC_CACHE_ROOT, z, x, `${yBase}.png`);
}

function emptyResponse(): Response {
  return new Response(new Uint8Array(TRANSPARENT_PNG), {
    status: 200,
    headers: {
      'content-type': 'image/png',
      'cache-control': 'public, max-age=2592000',
      'x-cache': 'EMPTY',
      'access-control-allow-origin': '*',
    },
  });
}

async function serveFromDisk(path: string): Promise<Response | null> {
  try {
    const s = await stat(path);
    if (Date.now() - s.mtimeMs > MAX_AGE_MS) return null;
    const buf = await readFile(path);
    return new Response(new Uint8Array(buf), {
      status: 200,
      headers: {
        'content-type': 'image/png',
        'cache-control': 'public, max-age=2592000',
        'x-cache': 'HIT',
        'access-control-allow-origin': '*',
      },
    });
  } catch {
    return null;
  }
}

async function fetchAndCache(
  zNum: number,
  x: string,
  y: string,
  diskPath: string,
): Promise<Response> {
  const yBase = y.replace(/\.png$/, '');
  const noaaZ = zNum - 2;
  const url =
    `https://gis.charttools.noaa.gov/arcgis/rest/services/` +
    `MarineChart_Services/NOAACharts/MapServer/tile/${noaaZ}/${yBase}/${x}`;
  const r = await fetch(url, {
    headers: { 'user-agent': USER_AGENT },
    signal: AbortSignal.timeout(15_000),
  });
  if (!r.ok) {
    return new Response(`upstream tile ${url} → ${r.status}`, {
      status: r.status === 404 ? 404 : 502,
      headers: { 'access-control-allow-origin': '*' },
    });
  }
  const buf = Buffer.from(await r.arrayBuffer());
  void (async () => {
    try {
      await mkdir(dirname(diskPath), { recursive: true });
      await writeFile(diskPath, buf);
    } catch {
      /* ignore — serving the response is more important than caching */
    }
  })();
  return new Response(new Uint8Array(buf), {
    status: 200,
    headers: {
      'content-type': 'image/png',
      'cache-control': 'public, max-age=2592000',
      'x-cache': 'MISS',
      'access-control-allow-origin': '*',
    },
  });
}

export async function GET(
  _req: Request,
  ctx: { params: Promise<{ z: string; x: string; y: string }> },
): Promise<Response> {
  const { z, x, y } = await ctx.params;
  if (!/^\d{1,2}$/.test(z) || !/^\d{1,7}$/.test(x) || !/^\d{1,7}(\.png)?$/.test(y)) {
    return new Response('bad tile coords', {
      status: 400,
      headers: { 'access-control-allow-origin': '*' },
    });
  }
  const zNum = Number(z);
  if (zNum < MIN_Z || zNum > MAX_Z) {
    return emptyResponse();
  }
  const path = tilePath(z, x, y);
  const fromDisk = await serveFromDisk(path);
  if (fromDisk) return fromDisk;
  return fetchAndCache(zNum, x, y, path);
}
