import { tileProxy } from '../../../../../../lib/tile-proxy';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * On-disk OpenSeaMap seamark tile cache. Mounted at
 * /api/seamark-tiles/{z}/{x}/{y}(.png). On a miss we fetch from
 * `tiles.openseamap.org/seamark/{z}/{x}/{y}.png` (standard XYZ order),
 * persist under `${G5000_ROUTER_ROOT}/seamark-cache`, and stream the body.
 *
 * Mirrors the OSM proxy at /api/tiles. OpenSeaMap data is CC-BY-SA;
 * attribution is provided via the MapLibre source's `attribution`
 * property in `SeamarkLayer.tsx`. Strict error policy (5xx → 502); disk
 * tiles older than 30 days are re-fetched.
 */
export const GET = tileProxy({
  cacheSubdir: 'seamark-cache',
  ext: 'png',
  contentType: 'image/png',
  upstreamUrl: (z, x, y) => `https://tiles.openseamap.org/seamark/${z}/${x}/${y}.png`,
  maxAgeMs: 30 * 24 * 3600 * 1000, // 30 days
  errorPolicy: 'strict',
  timeoutMs: 15_000,
});
