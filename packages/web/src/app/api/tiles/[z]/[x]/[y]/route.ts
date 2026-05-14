import { mkdir, readFile, writeFile, stat } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { ROOT } from '../../../../../../lib/paths';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * On-disk OSM tile cache.
 *
 * Mounted at /api/tiles/{z}/{x}/{y}.png so the chart's maplibre style
 * can point at a same-origin URL. On a miss we fetch from
 * `tile.openstreetmap.org`, persist to disk, and stream the response
 * back. Subsequent requests for the same (z,x,y) serve from disk and
 * never hit the network.
 *
 * Cache location: `${G5000_ROUTER_ROOT}/tile-cache/{z}/{x}/{y}.png`.
 * Defaults to `~/.g5000-router/tile-cache`. Same root that already
 * holds grib-cache, plans, waypoints, etc.
 *
 * OSM's tile usage policy:
 *   - Requires a descriptive User-Agent (set below).
 *   - Allows caching for end-user clients; a private boat's tiles for
 *     offline use is well within the policy.
 *   - We re-fetch on disk hit older than `MAX_AGE_MS` (30 days) so the
 *     cache picks up roadway / coastline updates over a long enough
 *     window without re-downloading everything weekly.
 */

const TILE_CACHE_ROOT = join(ROOT, 'tile-cache');
const MAX_AGE_MS = 30 * 24 * 3600 * 1000; // 30 days
const USER_AGENT = 'g5000-marine-router/1.0 (https://g5000.sulabassana.net)';

function tilePath(z: string, x: string, y: string): string {
  // Strip any `.png` suffix Next.js might pass through, then re-add.
  const yBase = y.replace(/\.png$/, '');
  return join(TILE_CACHE_ROOT, z, x, `${yBase}.png`);
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
        'cache-control': 'public, max-age=2592000', // 30 days, browser side
        'x-cache': 'HIT',
      },
    });
  } catch {
    return null;
  }
}

async function fetchAndCache(
  z: string,
  x: string,
  y: string,
  diskPath: string,
): Promise<Response> {
  const yBase = y.replace(/\.png$/, '');
  const url = `https://tile.openstreetmap.org/${z}/${x}/${yBase}.png`;
  const r = await fetch(url, {
    headers: { 'user-agent': USER_AGENT },
    signal: AbortSignal.timeout(15_000),
  });
  if (!r.ok) {
    return new Response(`upstream tile ${url} → ${r.status}`, {
      status: r.status === 404 ? 404 : 502,
    });
  }
  const buf = Buffer.from(await r.arrayBuffer());
  // Best-effort write; if disk is full or permissions block us we still
  // serve the body. Misses just become more expensive, not broken.
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
    },
  });
}

export async function GET(
  _req: Request,
  ctx: { params: Promise<{ z: string; x: string; y: string }> },
): Promise<Response> {
  const { z, x, y } = await ctx.params;
  if (!/^\d{1,2}$/.test(z) || !/^\d{1,7}$/.test(x) || !/^\d{1,7}(\.png)?$/.test(y)) {
    return new Response('bad tile coords', { status: 400 });
  }
  const path = tilePath(z, x, y);
  const fromDisk = await serveFromDisk(path);
  if (fromDisk) return fromDisk;
  return fetchAndCache(z, x, y, path);
}
