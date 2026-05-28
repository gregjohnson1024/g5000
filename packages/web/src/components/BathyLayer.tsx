'use client';
import { useEffect, useRef } from 'react';
import type maplibregl from 'maplibre-gl';

const SOURCE_ID = 'bathy-contours';
const LINE_LAYER_ID = 'bathy-contour-line';

/** Debounce so a flurry of moveend events triggers one fetch. */
const DEBOUNCE_MS = 600;

function resForZoom(zoom: number): 'low' | 'high' {
  // Only close-in views ask GMRT for 'high' (small viewport → small grid).
  // 'low' is already ≈GEBCO-native resolution for the broader views.
  return zoom >= 8 ? 'high' : 'low';
}

/**
 * Depth-contour overlay sourced from /api/bathy/contours (GMRT/GEBCO). On
 * mount and on every (debounced) map move it requests contours for the
 * current viewport bbox and replaces the source data. Depth is read from the
 * line colour (shallow cyan → deep navy) and width (major isobaths ≥200 m are
 * thicker). No text labels: the base map style ships no `glyphs` font source
 * (it's an offline raster style), so a symbol layer's `text-field` can't render.
 *
 * NOT for navigation — GMRT/GEBCO is an interpolated ~450 m grid that smooths
 * out shoals and isolated dangers. Situational awareness only.
 */
export function BathyLayer({ map, visible }: { map: maplibregl.Map | null; visible: boolean }) {
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    if (!map) return;

    const ensure = (): void => {
      try {
        if (!map.getSource(SOURCE_ID)) {
          map.addSource(SOURCE_ID, {
            type: 'geojson',
            data: { type: 'FeatureCollection', features: [] },
          });
        }
        if (!map.getLayer(LINE_LAYER_ID)) {
          map.addLayer({
            id: LINE_LAYER_ID,
            type: 'line',
            source: SOURCE_ID,
            layout: { 'line-join': 'round' },
            paint: {
              // Depth gradient: shallow cyan → deep navy (depth is positive m).
              'line-color': [
                'step',
                ['get', 'depth'],
                '#7dd3fc',
                50,
                '#38bdf8',
                200,
                '#2563eb',
                1000,
                '#1e3a8a',
              ],
              // Major isobaths (>=200 m) thicker than the shallow set.
              'line-width': ['case', ['>=', ['get', 'depth'], 200], 1.6, 0.8],
              'line-opacity': ['case', ['>=', ['get', 'depth'], 200], 0.9, 0.6],
            },
          });
        }
        if (map.getLayer(LINE_LAYER_ID)) {
          map.setLayoutProperty(LINE_LAYER_ID, 'visibility', visible ? 'visible' : 'none');
        }
      } catch {
        /* style not ready — styledata retry covers it */
      }
    };

    const refresh = (): void => {
      if (!visible) return;
      const b = map.getBounds();
      const params = new URLSearchParams({
        latMin: String(b.getSouth()),
        latMax: String(b.getNorth()),
        lonMin: String(b.getWest()),
        lonMax: String(b.getEast()),
        res: resForZoom(map.getZoom()),
      });
      abortRef.current?.abort();
      const ac = new AbortController();
      abortRef.current = ac;
      void fetch(`/api/bathy/contours?${params}`, { signal: ac.signal })
        .then((r) => r.json())
        .then((fc: GeoJSON.FeatureCollection) => {
          const src = map.getSource(SOURCE_ID) as maplibregl.GeoJSONSource | undefined;
          if (src && fc?.type === 'FeatureCollection') src.setData(fc);
        })
        .catch(() => {
          /* aborted or network error — leave prior contours in place */
        });
    };

    const onMoveEnd = (): void => {
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(refresh, DEBOUNCE_MS);
    };

    ensure();
    if (visible) refresh();
    map.on('styledata', ensure);
    map.on('moveend', onMoveEnd);

    return () => {
      map.off('styledata', ensure);
      map.off('moveend', onMoveEnd);
      if (timerRef.current) clearTimeout(timerRef.current);
      abortRef.current?.abort();
      try {
        if (map.getLayer(LINE_LAYER_ID)) map.removeLayer(LINE_LAYER_ID);
        if (map.getSource(SOURCE_ID)) map.removeSource(SOURCE_ID);
      } catch {
        /* map torn down */
      }
    };
  }, [map, visible]);

  return null;
}
