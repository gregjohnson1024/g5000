import { tileProxy } from '../../../../../../lib/tile-proxy';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * On-disk OSM tile cache. Mounted at /api/tiles/{z}/{x}/{y}.png so the
 * chart's maplibre style can point at a same-origin URL. On a miss we
 * fetch from `tile.openstreetmap.org` (standard {z}/{x}/{y}.png order),
 * persist under `${G5000_ROUTER_ROOT}/tile-cache`, and stream the body.
 *
 * OSM's tile usage policy requires a descriptive User-Agent (set in the
 * factory) and allows caching for end-user clients; a private boat's
 * offline tiles are well within policy. Disk tiles older than 30 days are
 * re-fetched. Strict error policy: a 5xx upstream surfaces as 502.
 */
export const GET = tileProxy({
  cacheSubdir: 'tile-cache',
  ext: 'png',
  contentType: 'image/png',
  upstreamUrl: (z, x, y) => `https://tile.openstreetmap.org/${z}/${x}/${y}.png`,
  maxAgeMs: 30 * 24 * 3600 * 1000, // 30 days
  errorPolicy: 'strict',
  timeoutMs: 15_000,
});
