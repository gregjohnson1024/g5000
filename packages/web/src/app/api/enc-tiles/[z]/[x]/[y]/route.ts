import { tileProxy } from '../../../../../../lib/tile-proxy';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * On-disk NOAA NCDS chart tile cache. Mounted at
 * /api/enc-tiles/{z}/{x}/{y}(.png). The browser sends standard XYZ; we
 * translate to NOAA's ArcGIS conventions:
 *
 *   - NOAA's z=0 is 1/4 the resolution of standard XYZ z=0, so
 *     `noaa_z = standard_z - 2`. NOAA covers noaa_z=0..16, i.e.
 *     standard_z=2..18. Outside that band the factory serves a
 *     transparent 1x1 PNG (status 200, x-cache=EMPTY) to keep MapLibre
 *     quiet.
 *   - ArcGIS uses `/tile/{z}/{row}/{col}` — y BEFORE x — so the upstream
 *     URL swaps the order of our incoming {x}/{y} params.
 *
 * Cache key uses the STANDARD XYZ coords (so cache keys match MapLibre's
 * requests one-to-one) under `${G5000_ROUTER_ROOT}/enc-cache`. NOAA NCDS
 * data is public domain; attribution is via the MapLibre source's
 * `attribution` property in `EncLayer.tsx`.
 *
 * Soft error policy: NOAA's dynamic-render service can be slow / flaky, so
 * a timeout (25 s) or 5xx falls back to a transparent placeholder
 * (x-cache=TIMEOUT / UPSTREAM-5XX, max-age=60) rather than a broken image.
 */
export const GET = tileProxy({
  cacheSubdir: 'enc-cache',
  ext: 'png',
  contentType: 'image/png',
  // noaa_z = std_z - 2; ArcGIS row/col order /tile/{z}/{y}/{x}.
  upstreamUrl: (z, x, y) =>
    `https://gis.charttools.noaa.gov/arcgis/rest/services/` +
    `MarineChart_Services/NOAACharts/MapServer/tile/${Number(z) - 2}/${y}/${x}`,
  maxAgeMs: 30 * 24 * 3600 * 1000, // 30 days
  zoomBand: { min: 2, max: 18 }, // standard-z coverage band
  errorPolicy: 'soft',
  timeoutMs: 25_000,
});
