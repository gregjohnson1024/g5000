'use client';
import { useEffect, useRef } from 'react';
import maplibregl from 'maplibre-gl';

export interface MarkLike {
  lat: number;
  lon: number;
  name?: string;
  /**
   * Optional badge — 'S' / 'E' renders a coloured ring around the dot to
   * call out start/end of an in-progress route. Plain waypoints get the
   * default amber dot.
   */
  badge?: 'S' | 'E';
}

const SOURCE_ID = 'waypoints';
const DOT_LAYER = 'waypoints-dot';
const RING_LAYER = 'waypoints-ring';

/**
 * Renders all marks (waypoints + the route's start/end) as small dots on
 * the chart. Always visible — these are the user's persistent navigation
 * marks plus any in-flight route endpoints. HTML markers (one per mark)
 * carry the name labels, because the maplibre style has no glyphs URL
 * (so a `symbol` layer with `text-field` would be silently dropped).
 *
 * Z-order: dots and rings are maplibre layers so they sit above the
 * `__above-wind__` sentinel — i.e. above wind, on top of the chart.
 */
export function WaypointsLayer({
  map,
  marks,
}: {
  map: maplibregl.Map | null;
  marks: MarkLike[];
}) {
  // Persistent across re-renders so the marks-change effect can update
  // labels without tearing down the layer.
  const labelMarkersRef = useRef<Map<string, maplibregl.Marker>>(new Map());
  const marksRef = useRef<MarkLike[]>(marks);
  const syncRef = useRef<(() => void) | null>(null);
  marksRef.current = marks;

  // Marks-change effect: just re-run sync via the ref. Does NOT tear down
  // the layer — that only happens on unmount.
  useEffect(() => {
    syncRef.current?.();
  }, [marks]);

  useEffect(() => {
    if (!map) return;
    const labelMarkers = labelMarkersRef.current;

    const ensure = (): void => {
      if (!map.getSource(SOURCE_ID)) {
        map.addSource(SOURCE_ID, {
          type: 'geojson',
          data: { type: 'FeatureCollection', features: [] },
        });
      }
      if (!map.getLayer(RING_LAYER)) {
        map.addLayer({
          id: RING_LAYER,
          type: 'circle',
          source: SOURCE_ID,
          filter: ['has', 'badge'],
          paint: {
            'circle-radius': 9,
            'circle-color': 'rgba(0,0,0,0)',
            'circle-stroke-width': 2,
            'circle-stroke-color': [
              'match',
              ['get', 'badge'],
              'S',
              '#22c55e',
              'E',
              '#ef4444',
              '#fbbf24',
            ],
          },
        });
      }
      if (!map.getLayer(DOT_LAYER)) {
        map.addLayer({
          id: DOT_LAYER,
          type: 'circle',
          source: SOURCE_ID,
          paint: {
            'circle-radius': 5,
            'circle-color': '#fbbf24',
            'circle-stroke-color': '#0f172a',
            'circle-stroke-width': 1.2,
          },
        });
      }
    };

    const sync = (): void => {
      if (!map.isStyleLoaded()) return;
      ensure();
      const src = map.getSource(SOURCE_ID) as maplibregl.GeoJSONSource | undefined;
      if (!src) return;
      const currentMarks = marksRef.current;
      const features = currentMarks
        .filter((m) => Number.isFinite(m.lat) && Number.isFinite(m.lon))
        .map((m, i) => ({
          type: 'Feature' as const,
          geometry: { type: 'Point' as const, coordinates: [m.lon, m.lat] },
          properties: {
            id: `${i}`,
            name: m.name ?? null,
            ...(m.badge ? { badge: m.badge } : {}),
          },
        }));
      src.setData({ type: 'FeatureCollection', features });

      // HTML labels. The maplibre style has no glyphs URL, so symbol
      // layers with text-field render nothing. DOM markers sidestep that.
      const live = new Set<string>();
      for (const m of currentMarks) {
        if (!Number.isFinite(m.lat) || !Number.isFinite(m.lon)) continue;
        const key = `${m.lat.toFixed(5)},${m.lon.toFixed(5)}`;
        live.add(key);
        const label = m.badge === 'S' ? `S — ${m.name ?? ''}`
          : m.badge === 'E' ? `E — ${m.name ?? ''}`
          : m.name ?? '';
        if (!label.trim()) continue;
        let mk = labelMarkers.get(key);
        if (!mk) {
          const el = document.createElement('div');
          el.style.cssText =
            'font: 11px/1.1 ui-monospace, SFMono-Regular, Menlo, monospace;' +
            'color: #cbd5e1; background: rgba(11,14,20,0.7);' +
            'padding: 1px 4px; border-radius: 2px;' +
            'transform: translateY(10px); white-space: nowrap;' +
            'pointer-events: none;';
          el.textContent = label;
          mk = new maplibregl.Marker({ element: el, anchor: 'top' });
          mk.setLngLat([m.lon, m.lat]).addTo(map);
          labelMarkers.set(key, mk);
        } else {
          mk.setLngLat([m.lon, m.lat]);
          if (mk.getElement().textContent !== label) mk.getElement().textContent = label;
        }
      }
      for (const [k, mk] of labelMarkers) {
        if (!live.has(k)) {
          try {
            mk.remove();
          } catch {
            /* ignore */
          }
          labelMarkers.delete(k);
        }
      }
    };

    if (map.isStyleLoaded()) sync();
    else map.once('load', sync);
    // Expose sync to the marks-change effect via a side-channel ref so
    // changing `marks` doesn't tear down the layer; we just re-run sync.
    syncRef.current = sync;

    return () => {
      syncRef.current = null;
      for (const mk of labelMarkers.values()) {
        try {
          mk.remove();
        } catch {
          /* ignore */
        }
      }
      labelMarkers.clear();
      for (const id of [DOT_LAYER, RING_LAYER]) {
        if (map.getLayer(id)) {
          try {
            map.removeLayer(id);
          } catch {
            /* ignore */
          }
        }
      }
      if (map.getSource(SOURCE_ID)) {
        try {
          map.removeSource(SOURCE_ID);
        } catch {
          /* ignore */
        }
      }
    };
    // Mount-once effect: deps are `[map]` only. The marks-change effect
    // above re-runs sync without tearing this down.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map]);

  return null;
}
