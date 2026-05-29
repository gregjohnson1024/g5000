'use client';
import { useEffect } from 'react';
import maplibregl from 'maplibre-gl';

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
  useEffect(() => {
    if (!map) return;
    // Do NOT gate on map.isStyleLoaded(); the chart page hands us `map` from
    // Map.tsx's onLoad, so add* is safe. try/catch survives an HMR teardown.
    const ensure = (): void => {
      try {
        if (!map.getSource(SOURCE_ID)) {
          map.addSource(SOURCE_ID, {
            type: 'raster',
            tiles: ['/api/sat-tiles/{z}/{x}/{y}'],
            tileSize: 256,
            minzoom: 0,
            maxzoom: 19,
            attribution: 'Esri, Maxar, Earthstar Geographics',
          });
        }
        if (!map.getLayer(LAYER_ID)) {
          const beforeId = map.getLayer('__above-wind__') ? '__above-wind__' : undefined;
          map.addLayer(
            {
              id: LAYER_ID,
              type: 'raster',
              source: SOURCE_ID,
              layout: { visibility: visible ? 'visible' : 'none' },
            },
            beforeId,
          );
        }
      } catch {
        /* style torn down mid-render; next styledata retries */
      }
    };

    ensure();
    map.on('styledata', ensure);
    return () => {
      map.off('styledata', ensure);
    };
  }, [map, visible]);

  useEffect(() => {
    if (!map) return;
    if (!map.getLayer(LAYER_ID)) return;
    map.setLayoutProperty(LAYER_ID, 'visibility', visible ? 'visible' : 'none');
  }, [map, visible]);

  return null;
}
