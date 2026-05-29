'use client';
import type maplibregl from 'maplibre-gl';
import { useRasterTileLayer } from './use-raster-tile-layer';

const SOURCE_ID = 'noaa-enc';
const LAYER_ID = 'noaa-enc-layer';
/** Standard XYZ floor. NOAA serves tiles from std z=2 (their z=0) upward.
 * ZoomIndicator imports this to amber-tint when the user is below the
 * floor with NOAA enabled. */
export const NOAA_MIN_ZOOM = 2;

/**
 * NOAA NCDS paper-chart raster overlay. Opaque tiles covering the
 * OSM basemap with the full nautical chart rendering — depth
 * contours, lit aids with characteristic, harbour limits, dredged
 * channels, anchorages.
 *
 * Tiles come from the same-origin /api/enc-tiles proxy, which
 * handles the XYZ → NOAA z-2 translation and disk caches under
 * ~/.g5000-router/enc-cache.
 *
 * Drawn beneath the `__above-wind__` z-order sentinel installed by
 * Map.tsx, so wind / AIS / route / range-rings render on top.
 *
 * Coverage is US waters and territories only. NOAA's tile grid
 * tops out at standard XYZ z=18 (their z=16) — minzoom/maxzoom
 * on the source keep MapLibre from requesting outside that band.
 */
export function EncLayer({ map, visible }: { map: maplibregl.Map | null; visible: boolean }) {
  useRasterTileLayer({
    map,
    visible,
    sourceId: SOURCE_ID,
    layerId: LAYER_ID,
    source: {
      type: 'raster',
      tiles: ['/api/enc-tiles/{z}/{x}/{y}.png'],
      tileSize: 256,
      minzoom: NOAA_MIN_ZOOM,
      maxzoom: 18,
      attribution: 'NOAA / Office of Coast Survey',
    },
    layer: { type: 'raster' },
  });

  return null;
}

/**
 * Force MapLibre to drop its in-memory tile cache for the NOAA layer and
 * re-fetch every visible tile from the disk-cache. Use this after running
 * the seed script (or after a long offshore pause) to pull newly-cached
 * tiles into view without panning the chart.
 *
 * Calling `setTiles()` with the SAME URL is a no-op in MapLibre — internal
 * tile keys don't change so the existing cache stays. To force a true
 * cache bust we append a cache-busting query param that MapLibre treats
 * as a new URL; the proxy ignores the param and serves from disk, so the
 * disk cache benefit is preserved.
 *
 * Why not poll periodically? `setTiles()` aborts in-flight tile fetches
 * as a side effect, and at NOAA's 5–25 s timeout that wastes a lot of
 * work and floods the dev console with AbortError noise. Manual trigger
 * is the right shape: the user knows when they expect new content.
 */
export function refreshEncTiles(map: maplibregl.Map | null): boolean {
  if (!map) return false;
  try {
    const src = map.getSource(SOURCE_ID);
    if (src && 'setTiles' in src && typeof src.setTiles === 'function') {
      const buster = Date.now();
      src.setTiles([`/api/enc-tiles/{z}/{x}/{y}.png?v=${buster}`]);
      return true;
    }
  } catch {
    /* map torn down mid-call */
  }
  return false;
}
