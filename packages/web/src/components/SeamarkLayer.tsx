'use client';
import { useEffect } from 'react';
import maplibregl from 'maplibre-gl';

const SOURCE_ID = 'osm-seamark';
const LAYER_ID = 'osm-seamark-layer';

/**
 * OpenSeaMap seamark raster overlay. Renders buoys, lit aids, harbour
 * limits, anchorages, soundings, and similar nautical chart features
 * on top of the OSM basemap.
 *
 * Tiles come from the same-origin /api/seamark-tiles proxy so they're
 * cached on disk under ~/.g5000-router/seamark-cache and survive
 * offline use once warmed.
 *
 * Drawn beneath the `__above-wind__` z-order sentinel installed by
 * Map.tsx, so wind / AIS / route / range-rings / laylines all sit
 * above the seamark layer.
 */
export function SeamarkLayer({
  map,
  visible,
}: {
  map: maplibregl.Map | null;
  visible: boolean;
}) {
  useEffect(() => {
    if (!map) return;
    const ensure = (): void => {
      if (!map.getSource(SOURCE_ID)) {
        map.addSource(SOURCE_ID, {
          type: 'raster',
          tiles: ['/api/seamark-tiles/{z}/{x}/{y}.png'],
          tileSize: 256,
          attribution: '© OpenSeaMap (CC-BY-SA)',
        });
      }
      if (!map.getLayer(LAYER_ID)) {
        const beforeId = map.getLayer('__above-wind__')
          ? '__above-wind__'
          : undefined;
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
    };
    if (map.isStyleLoaded()) ensure();
    else map.once('load', ensure);
  }, [map, visible]);

  useEffect(() => {
    if (!map) return;
    if (!map.getLayer(LAYER_ID)) return;
    map.setLayoutProperty(LAYER_ID, 'visibility', visible ? 'visible' : 'none');
  }, [map, visible]);

  return null;
}
