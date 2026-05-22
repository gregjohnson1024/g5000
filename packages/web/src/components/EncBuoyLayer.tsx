'use client';
import { useEffect } from 'react';
import maplibregl from 'maplibre-gl';

const SOURCE_ID = 'noaa-vector-buoys';
const LAYER_ID = 'noaa-vector-buoys-layer';

const EMPTY_COLLECTION: GeoJSON.FeatureCollection = {
  type: 'FeatureCollection',
  features: [],
};

/**
 * NOAA vector overlay — buoys (Coastal usage band only).
 *
 * Reads features from /api/enc-features?class=buoys&bbox=…, normalised
 * upstream so each feature carries `colourCode` (numeric S-57 colour 1..13,
 * or 0 when unknown). Renders one circle per buoy, coloured via the
 * MapLibre `match` paint expression below.
 *
 * Drawn beneath the `__above-wind__` z-order sentinel installed by Map.tsx,
 * so wind / AIS / route / range-rings render on top.
 *
 * v1 scope: no fetching yet — see EncBuoyLayer-fetch in the follow-up task.
 */
export function EncBuoyLayer({
  map,
  visible,
}: {
  map: maplibregl.Map | null;
  visible: boolean;
}): null {
  useEffect(() => {
    if (!map) return;

    const ensure = (): void => {
      try {
        if (!map.getSource(SOURCE_ID)) {
          map.addSource(SOURCE_ID, { type: 'geojson', data: EMPTY_COLLECTION });
        }
        if (!map.getLayer(LAYER_ID)) {
          const beforeId = map.getLayer('__above-wind__') ? '__above-wind__' : undefined;
          map.addLayer(
            {
              id: LAYER_ID,
              type: 'circle',
              source: SOURCE_ID,
              paint: {
                'circle-radius': 5,
                'circle-stroke-width': 1,
                'circle-stroke-color': '#000',
                // S-57 colour codes: 1=white, 2=black, 3=red, 4=green,
                // 5=blue, 6=yellow, 7=grey, 8=brown, 9=amber, 10=violet,
                // 11=orange, 12=magenta, 13=pink. Anything else falls
                // through to a neutral grey.
                'circle-color': [
                  'match',
                  ['get', 'colourCode'],
                  1, '#f5f5f5',
                  2, '#222222',
                  3, '#dd2222',
                  4, '#22aa22',
                  5, '#1166cc',
                  6, '#e6c200',
                  7, '#888888',
                  8, '#7a4d22',
                  9, '#dd9933',
                  10, '#8855aa',
                  11, '#ee7722',
                  12, '#c33388',
                  13, '#dd88aa',
                  '#888888',
                ],
              },
              layout: { visibility: visible ? 'visible' : 'none' },
            },
            beforeId,
          );
        }
      } catch {
        /* style torn down mid-render; styledata retry handles it */
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
