'use client';

import { useEffect, useState } from 'react';
import maplibregl from 'maplibre-gl';

interface LineEnd {
  lat: number;
  lon: number;
}
interface LineSnap {
  port?: LineEnd;
  stbd?: LineEnd;
}

const LINE_SOURCE = 'race-start-line';
const LINE_LAYER = 'race-start-line-layer';
const POINTS_LAYER = `${LINE_LAYER}-points`;

/**
 * Renders the race start line as a dashed amber segment between port (green
 * dot) and starboard (red dot) ends. Polls /api/race/state every 2 s and
 * tears itself down when neither end is set.
 *
 * Returns null — pure side-effect component that writes MapLibre layers.
 */
export function StartLineLayer({ map }: { map: maplibregl.Map | null }): null {
  const [line, setLine] = useState<LineSnap>({});

  useEffect(() => {
    let stopped = false;
    async function poll(): Promise<void> {
      try {
        const r = await fetch('/api/race/state', { cache: 'no-store' });
        if (stopped || !r.ok) return;
        const j = await r.json();
        setLine(j.line ?? {});
      } catch {
        /* retry on next tick */
      }
    }
    void poll();
    const id = setInterval(poll, 2000);
    return () => {
      stopped = true;
      clearInterval(id);
    };
  }, []);

  useEffect(() => {
    if (!map) return;

    const sync = (): void => {
      if (!map.isStyleLoaded()) return;

      if (!line.port || !line.stbd) {
        // Remove layers and source if no complete line is defined.
        if (map.getLayer(POINTS_LAYER)) {
          try {
            map.removeLayer(POINTS_LAYER);
          } catch {
            /* ignore */
          }
        }
        if (map.getLayer(LINE_LAYER)) {
          try {
            map.removeLayer(LINE_LAYER);
          } catch {
            /* ignore */
          }
        }
        if (map.getSource(LINE_SOURCE)) {
          try {
            map.removeSource(LINE_SOURCE);
          } catch {
            /* ignore */
          }
        }
        return;
      }

      const fc = {
        type: 'FeatureCollection',
        features: [
          {
            type: 'Feature',
            properties: {},
            geometry: {
              type: 'LineString',
              coordinates: [
                [line.port.lon, line.port.lat],
                [line.stbd.lon, line.stbd.lat],
              ],
            },
          },
          {
            type: 'Feature',
            properties: { end: 'port' },
            geometry: {
              type: 'Point',
              coordinates: [line.port.lon, line.port.lat],
            },
          },
          {
            type: 'Feature',
            properties: { end: 'stbd' },
            geometry: {
              type: 'Point',
              coordinates: [line.stbd.lon, line.stbd.lat],
            },
          },
        ],
      };

      const src = map.getSource(LINE_SOURCE) as maplibregl.GeoJSONSource | undefined;
      if (src) {
        src.setData(fc as never);
      } else {
        map.addSource(LINE_SOURCE, { type: 'geojson', data: fc as never });
        map.addLayer({
          id: LINE_LAYER,
          type: 'line',
          source: LINE_SOURCE,
          filter: ['==', '$type', 'LineString'],
          paint: {
            'line-color': '#fbbf24',
            'line-width': 3,
            'line-dasharray': [2, 2],
          },
        });
        map.addLayer({
          id: POINTS_LAYER,
          type: 'circle',
          source: LINE_SOURCE,
          filter: ['==', '$type', 'Point'],
          paint: {
            'circle-radius': 6,
            'circle-color': [
              'match',
              ['get', 'end'],
              'port',
              '#10b981',
              'stbd',
              '#ef4444',
              '#ffffff',
            ],
            'circle-stroke-color': '#000',
            'circle-stroke-width': 1.5,
          },
        });
      }
    };

    if (map.isStyleLoaded()) sync();
    else map.once('load', sync);

    return () => {
      // Cleanup on unmount or map change only — line changes re-run sync.
    };
  }, [map, line]);

  // Cleanup layers on unmount.
  useEffect(() => {
    if (!map) return;
    return () => {
      for (const id of [POINTS_LAYER, LINE_LAYER]) {
        if (map.getLayer(id)) {
          try {
            map.removeLayer(id);
          } catch {
            /* ignore */
          }
        }
      }
      if (map.getSource(LINE_SOURCE)) {
        try {
          map.removeSource(LINE_SOURCE);
        } catch {
          /* ignore */
        }
      }
    };
  }, [map]);

  return null;
}
