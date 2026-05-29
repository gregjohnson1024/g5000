'use client';
import type maplibregl from 'maplibre-gl';
import { useRasterTileLayer } from './use-raster-tile-layer';

const SOURCE_ID = 'esri-satellite';
const LAYER_ID = 'esri-satellite-layer';

/**
 * Esri World Imagery satellite raster overlay. Opaque global imagery served
 * via the same-origin /api/sat-tiles proxy (disk-cached for offline use).
 *
 * Drawn beneath the `__above-wind__` z-order sentinel installed by Map.tsx.
 * IMPORTANT: mount this AFTER <EncLayer> in chart/page.tsx so satellite
 * stacks on top of the NOAA chart but below the vector buoys + annotations.
 */
export function SatelliteLayer({ map, visible }: { map: maplibregl.Map | null; visible: boolean }) {
  useRasterTileLayer({
    map,
    visible,
    sourceId: SOURCE_ID,
    layerId: LAYER_ID,
    source: {
      type: 'raster',
      tiles: ['/api/sat-tiles/{z}/{x}/{y}'],
      tileSize: 256,
      minzoom: 0,
      maxzoom: 19,
      attribution: 'Esri, Maxar, Earthstar Geographics',
    },
    layer: { type: 'raster' },
  });

  return null;
}
