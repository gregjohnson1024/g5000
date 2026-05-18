'use client';

import { useEffect } from 'react';
import maplibregl from 'maplibre-gl';
import { useSse } from '../hooks/use-sse';

const LAYLINE_SOURCE = 'race-laylines';
const LAYLINE_LAYER = 'race-laylines-layer';

function parsePoly(raw: string | undefined): Array<{ lat: number; lon: number }> {
  if (!raw) return [];
  try {
    const arr = JSON.parse(raw) as Array<{ lat: number; lon: number }>;
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
}

export function LaylinesLayer({ map }: { map: maplibregl.Map | null }): null {
  const { channels } = useSse();
  const portSample = channels.get('race.laylines.port');
  const stbdSample = channels.get('race.laylines.stbd');
  const portRaw = portSample?.value.kind === 'enum' ? portSample.value.value : undefined;
  const stbdRaw = stbdSample?.value.kind === 'enum' ? stbdSample.value.value : undefined;

  useEffect(() => {
    if (!map) return;
    return () => {
      try {
        if (map.getLayer(LAYLINE_LAYER)) map.removeLayer(LAYLINE_LAYER);
        if (map.getSource(LAYLINE_SOURCE)) map.removeSource(LAYLINE_SOURCE);
      } catch {
        /* ignored */
      }
    };
  }, [map]);

  useEffect(() => {
    if (!map) return;
    const port = parsePoly(portRaw);
    const stbd = parsePoly(stbdRaw);

    const sync = (): void => {
      if (port.length === 0 && stbd.length === 0) {
        try {
          if (map.getLayer(LAYLINE_LAYER)) map.removeLayer(LAYLINE_LAYER);
          if (map.getSource(LAYLINE_SOURCE)) map.removeSource(LAYLINE_SOURCE);
        } catch {
          /* ignored */
        }
        return;
      }
      const features: Array<{
        type: string;
        properties: Record<string, unknown>;
        geometry: Record<string, unknown>;
      }> = [];
      if (port.length > 0) {
        features.push({
          type: 'Feature',
          properties: { tack: 'port' },
          geometry: { type: 'LineString', coordinates: port.map((p) => [p.lon, p.lat]) },
        });
      }
      if (stbd.length > 0) {
        features.push({
          type: 'Feature',
          properties: { tack: 'stbd' },
          geometry: { type: 'LineString', coordinates: stbd.map((p) => [p.lon, p.lat]) },
        });
      }
      const fc = { type: 'FeatureCollection', features };
      const src = map.getSource(LAYLINE_SOURCE) as maplibregl.GeoJSONSource | undefined;
      if (src) {
        src.setData(fc as never);
      } else {
        map.addSource(LAYLINE_SOURCE, { type: 'geojson', data: fc as never });
        map.addLayer({
          id: LAYLINE_LAYER,
          type: 'line',
          source: LAYLINE_SOURCE,
          paint: {
            'line-color': [
              'match',
              ['get', 'tack'],
              'port',
              '#10b981',
              'stbd',
              '#ef4444',
              '#ffffff',
            ],
            'line-width': 2,
            'line-opacity': 0.7,
          },
        });
      }
    };

    if (map.isStyleLoaded()) {
      sync();
    } else {
      map.once('load', sync);
    }
  }, [map, portRaw, stbdRaw]);

  return null;
}
