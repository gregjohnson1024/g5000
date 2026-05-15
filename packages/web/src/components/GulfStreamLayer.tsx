'use client';
import { useEffect, useState } from 'react';
import maplibregl from 'maplibre-gl';

const SOURCE_ID = 'gulf-stream-north-wall';
const LINE_LAYER = 'gulf-stream-north-wall-line';
const CASING_LAYER = 'gulf-stream-north-wall-casing';

interface ApiResponse {
  ok: boolean;
  geojson?: GeoJSON.FeatureCollection;
  fetchedAt?: number;
}

/**
 * Draws the latest Gulf Stream North Wall contour on the chart as a
 * single styled line. Fetches `/api/gulf-stream/north-wall` once on
 * mount; the server caches the upstream NOAA data on disk with a
 * 6 h refresh so this is cheap.
 *
 * Rendered as a dark red line with a black casing for visibility
 * against the OSM tile basemap. Below the AIS / boat marker layers
 * so it never occludes anything navigationally critical.
 */
export function GulfStreamLayer({ map }: { map: maplibregl.Map | null }) {
  const [data, setData] = useState<GeoJSON.FeatureCollection | null>(null);

  useEffect(() => {
    let cancelled = false;
    console.log('[GulfStream] fetching /api/gulf-stream/north-wall');
    fetch('/api/gulf-stream/north-wall')
      .then((r) => r.json() as Promise<ApiResponse>)
      .then((j) => {
        if (cancelled) return;
        console.log('[GulfStream] fetch result ok=', j.ok, 'features=', j.geojson?.features?.length);
        if (j.ok && j.geojson) setData(j.geojson);
      })
      .catch((e) => {
        console.log('[GulfStream] fetch error', e);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    console.log('[GulfStream] render effect: map=', !!map, 'data=', !!data);
    if (!map || !data) return;

    const ensure = (): void => {
      console.log('[GulfStream] ensure() — styleLoaded=', map.isStyleLoaded());
      if (!map.getSource(SOURCE_ID)) {
        map.addSource(SOURCE_ID, { type: 'geojson', data });
        console.log('[GulfStream] addSource done');
      } else {
        const src = map.getSource(SOURCE_ID) as maplibregl.GeoJSONSource;
        src.setData(data);
        console.log('[GulfStream] setData done');
      }
      if (!map.getLayer(CASING_LAYER)) {
        map.addLayer({
          id: CASING_LAYER,
          type: 'line',
          source: SOURCE_ID,
          layout: { 'line-cap': 'round', 'line-join': 'round' },
          paint: {
            'line-color': '#000',
            'line-width': 5,
            'line-opacity': 0.6,
          },
        });
        console.log('[GulfStream] casing layer added');
      }
      if (!map.getLayer(LINE_LAYER)) {
        map.addLayer({
          id: LINE_LAYER,
          type: 'line',
          source: SOURCE_ID,
          layout: { 'line-cap': 'round', 'line-join': 'round' },
          paint: {
            'line-color': '#dc2626', // red-600 — high contrast against ocean blue/cream
            'line-width': 2.5,
            'line-opacity': 0.95,
          },
        });
        console.log('[GulfStream] line layer added — total layers now', map.getStyle().layers.length);
      }
    };

    if (map.isStyleLoaded()) {
      console.log('[GulfStream] style already loaded, calling ensure');
      ensure();
    } else {
      console.log('[GulfStream] style NOT loaded, waiting for load event');
      map.once('load', ensure);
    }

    return () => {
      // The map may already be torn down by the time we cleanup.
      try {
        for (const id of [LINE_LAYER, CASING_LAYER]) {
          if (map.getLayer(id)) map.removeLayer(id);
        }
        if (map.getSource(SOURCE_ID)) map.removeSource(SOURCE_ID);
      } catch {
        /* map is gone; nothing to do */
      }
    };
  }, [map, data]);

  return null;
}
