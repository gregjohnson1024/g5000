import { tileProxy } from '../../../../../../lib/tile-proxy';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * On-disk Esri World Imagery (satellite) tile cache. Mounted at
 * /api/sat-tiles/{z}/{x}/{y}(.jpg). The browser sends standard XYZ;
 * Esri's ArcGIS MapServer uses the SAME web-mercator zoom (NO offset,
 * unlike NOAA) but ArcGIS row/col order — `/tile/{z}/{row}/{col}` = y
 * BEFORE x.
 *
 * Cache under `${G5000_ROUTER_ROOT}/sat-cache/{z}/{x}/{y}.jpg`. Imagery is
 * static, so the on-disk freshness TTL is long (365 d). On a disk HIT we
 * bump mtime so a tile's mtime is its last-served time — that's what the
 * prune guard treats as "unused".
 *
 * Content-type quirk: HIT serves a hardcoded `image/jpeg`; MISS passes
 * upstream's content-type through (`?? image/jpeg`). Soft error policy: a
 * timeout (25 s) or 5xx falls back to a transparent PNG placeholder
 * (always image/png), max-age=60.
 */
export const GET = tileProxy({
  cacheSubdir: 'sat-cache',
  ext: 'jpg',
  contentType: 'image/jpeg',
  passthroughMiss: true,
  // No zoom offset (Number(z) normalizes, matching the original); ArcGIS
  // row/col order /tile/{z}/{y}/{x}.
  upstreamUrl: (z, x, y) =>
    `https://server.arcgisonline.com/ArcGIS/rest/services/` +
    `World_Imagery/MapServer/tile/${Number(z)}/${y}/${x}`,
  maxAgeMs: 365 * 24 * 3600 * 1000, // 365 days (imagery is static)
  zoomBand: { min: 0, max: 19 },
  errorPolicy: 'soft',
  timeoutMs: 25_000,
  bumpMtimeOnHit: true,
});
