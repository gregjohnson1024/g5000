import { mkdir, readFile, writeFile, stat, utimes } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { ROOT } from '../../../../../../lib/paths';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * On-disk Esri World Imagery tile cache.
 *
 * Mounted at /api/sat-tiles/{z}/{x}/{y}(.jpg) so the chart's maplibre source
 * can point at a same-origin URL. The browser sends standard XYZ; Esri's
 * ArcGIS MapServer uses the SAME web-mercator zoom (no offset, unlike NOAA)
 * but ArcGIS row/col order — `/tile/{z}/{row}/{col}` = y BEFORE x.
 *
 * Cache: `${G5000_ROUTER_ROOT}/sat-cache/{z}/{x}/{y}.jpg`. Imagery is static,
 * so the freshness TTL is long (365 d). On a disk HIT we bump mtime so a
 * tile's mtime is its last-served time — that's what the prune guard treats
 * as "unused".
 */
const SAT_CACHE_ROOT = join(ROOT, 'sat-cache');
const MAX_AGE_MS = 365 * 24 * 3600 * 1000;
const USER_AGENT = 'g5000-marine-router/1.0 (https://g5000.sulabassana.net)';
const MIN_Z = 0;
const MAX_Z = 19;

// 67-byte fully-transparent 1x1 PNG.
const TRANSPARENT_PNG = new Uint8Array([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d,
  0x49, 0x48, 0x44, 0x52, 0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01,
  0x08, 0x06, 0x00, 0x00, 0x00, 0x1f, 0x15, 0xc4, 0x89, 0x00, 0x00, 0x00,
  0x0d, 0x49, 0x44, 0x41, 0x54, 0x78, 0x9c, 0x63, 0x00, 0x01, 0x00, 0x00,
  0x05, 0x00, 0x01, 0x0d, 0x0a, 0x2d, 0xb4, 0x00, 0x00, 0x00, 0x00, 0x49,
  0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82,
]);

function tilePath(z: string, x: string, y: string): string {
  const yBase = y.replace(/\.jpg$/, '');
  return join(SAT_CACHE_ROOT, z, x, `${yBase}.jpg`);
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
    // Bump mtime → last-served time (LRU). Fire-and-forget; never block.
    const now = new Date();
    void utimes(path, now, now).catch(() => {});
    return new Response(new Uint8Array(buf), {
      status: 200,
      headers: {
        'content-type': 'image/jpeg',
        'cache-control': 'public, max-age=2592000',
        'x-cache': 'HIT',
        'access-control-allow-origin': '*',
      },
    });
  } catch {
    return null;
  }
}

function transparent(xCache: string): Response {
  return new Response(new Uint8Array(TRANSPARENT_PNG), {
    status: 200,
    headers: {
      'content-type': 'image/png',
      'cache-control': 'public, max-age=60',
      'x-cache': xCache,
      'access-control-allow-origin': '*',
    },
  });
}

async function fetchAndCache(
  zNum: number,
  x: string,
  y: string,
  diskPath: string,
): Promise<Response> {
  const yBase = y.replace(/\.jpg$/, '');
  // ArcGIS row/col order: {z}/{y}/{x}. No zoom offset.
  const url =
    `https://server.arcgisonline.com/ArcGIS/rest/services/` +
    `World_Imagery/MapServer/tile/${zNum}/${yBase}/${x}`;
  let r: Response;
  try {
    r = await fetch(url, {
      headers: { 'user-agent': USER_AGENT },
      signal: AbortSignal.timeout(25_000),
    });
  } catch {
    return transparent('TIMEOUT');
  }
  if (!r.ok) {
    if (r.status === 404) {
      return new Response(`upstream tile ${url} → 404`, {
        status: 404,
        headers: { 'access-control-allow-origin': '*' },
      });
    }
    return transparent('UPSTREAM-5XX');
  }
  const contentType = r.headers.get('content-type') ?? 'image/jpeg';
  const buf = Buffer.from(await r.arrayBuffer());
  void (async () => {
    try {
      await mkdir(dirname(diskPath), { recursive: true });
      await writeFile(diskPath, buf);
    } catch {
      /* serving beats caching */
    }
  })();
  return new Response(new Uint8Array(buf), {
    status: 200,
    headers: {
      'content-type': contentType,
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
  if (!/^\d{1,2}$/.test(z) || !/^\d{1,7}$/.test(x) || !/^\d{1,7}(\.jpg)?$/.test(y)) {
    return new Response('bad tile coords', {
      status: 400,
      headers: { 'access-control-allow-origin': '*' },
    });
  }
  const zNum = Number(z);
  if (zNum < MIN_Z || zNum > MAX_Z) return emptyResponse();
  const path = tilePath(z, x, y);
  const fromDisk = await serveFromDisk(path);
  if (fromDisk) return fromDisk;
  return fetchAndCache(zNum, x, y, path);
}
