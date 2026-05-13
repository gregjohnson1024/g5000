'use client';
import { useEffect, useRef } from 'react';
import maplibregl from 'maplibre-gl';

export interface LivePos {
  lat: number;
  lon: number;
  cog: number | null;
  sog: number | null;
  /** Heading (true), radians. Null if no source publishes it. */
  hdg: number | null;
  t: number;
}

export interface LiveBoatMarkerProps {
  /** Map instance from `onLoad`. Pass `null` until the map is ready. */
  map: maplibregl.Map | null;
  /** When true, flies the map to the boat on first fix. Default true. */
  flyToOnFirstFix?: boolean;
  /** Notified on every position event so the page can render live values. */
  onUpdate?: (p: LivePos) => void;
  /** Max points retained in the trail. Default 600 — at 1 Hz that's 10 min. */
  trailLength?: number;
}

const TRAIL_SOURCE_ID = 'live-trail';
const TRAIL_LAYER_ID = 'live-trail-layer';

/**
 * Subscribes to `/api/live/position` (SSE proxied from the autopilot-server)
 * and renders a triangle marker on the map at the boat's latest position.
 * The marker rotates to match COG when COG is available.
 *
 * Re-renders cheaply — no React state for the marker itself, the maplibre
 * marker is mutated directly on each fix to avoid re-creating DOM nodes.
 */
export function LiveBoatMarker({
  map,
  flyToOnFirstFix = true,
  onUpdate,
  trailLength = 600,
}: LiveBoatMarkerProps) {
  const markerRef = useRef<maplibregl.Marker | null>(null);
  const flownRef = useRef<boolean>(false);
  const trailRef = useRef<Array<[number, number]>>([]);
  const onUpdateRef = useRef(onUpdate);
  onUpdateRef.current = onUpdate;

  useEffect(() => {
    if (!map) return;

    const el = document.createElement('div');
    el.style.width = '20px';
    el.style.height = '20px';
    el.style.cursor = 'default';
    el.innerHTML = `
      <svg viewBox="0 0 20 20" width="20" height="20" xmlns="http://www.w3.org/2000/svg">
        <polygon points="10,2 16,18 10,14 4,18" fill="#fbbf24" stroke="#0b0e14" stroke-width="1.2"/>
      </svg>
    `;
    const marker = new maplibregl.Marker({ element: el, rotationAlignment: 'map' });
    markerRef.current = marker;

    // Ensure the trail source/layer exists. The map's `load` event may have
    // already fired by the time this effect runs (HMR / late attach), so
    // check synchronously and only register a listener if not yet loaded.
    const ensureTrailLayer = (): void => {
      if (map.getSource(TRAIL_SOURCE_ID)) return;
      map.addSource(TRAIL_SOURCE_ID, {
        type: 'geojson',
        data: { type: 'Feature', geometry: { type: 'LineString', coordinates: [] }, properties: {} },
      });
      map.addLayer({
        id: TRAIL_LAYER_ID,
        type: 'line',
        source: TRAIL_SOURCE_ID,
        layout: { 'line-join': 'round', 'line-cap': 'round' },
        paint: {
          'line-color': '#fbbf24',
          'line-width': 2,
          'line-opacity': 0.7,
        },
      });
    };
    if (map.isStyleLoaded()) ensureTrailLayer();
    else map.once('load', ensureTrailLayer);

    const updateTrail = (): void => {
      const src = map.getSource(TRAIL_SOURCE_ID) as maplibregl.GeoJSONSource | undefined;
      if (!src) return;
      src.setData({
        type: 'Feature',
        geometry: { type: 'LineString', coordinates: trailRef.current },
        properties: {},
      });
    };

    const es = new EventSource('/api/live/position');
    es.onmessage = (e) => {
      try {
        const p = JSON.parse(e.data) as LivePos;
        if (!Number.isFinite(p.lat) || !Number.isFinite(p.lon)) return;
        marker.setLngLat([p.lon, p.lat]);
        if (!marker.getElement().parentElement) marker.addTo(map);
        if (typeof p.cog === 'number') {
          marker.setRotation((p.cog * 180) / Math.PI);
        }
        // Trail: only push if moved noticeably to avoid duplicate points
        // when the boat is anchored / drifting under 1 m between fixes.
        const last = trailRef.current[trailRef.current.length - 1];
        const moved =
          !last || Math.abs(last[0] - p.lon) > 1e-5 || Math.abs(last[1] - p.lat) > 1e-5;
        if (moved) {
          trailRef.current.push([p.lon, p.lat]);
          if (trailRef.current.length > trailLength) {
            trailRef.current.splice(0, trailRef.current.length - trailLength);
          }
          updateTrail();
        }
        if (!flownRef.current && flyToOnFirstFix) {
          flownRef.current = true;
          map.flyTo({ center: [p.lon, p.lat], zoom: 9, speed: 1.2 });
        }
        onUpdateRef.current?.(p);
      } catch {
        /* ignore parse errors */
      }
    };

    return () => {
      es.close();
      try {
        marker.remove();
      } catch {
        /* map already torn down */
      }
      markerRef.current = null;
      // Layers not removed — parent Map.remove() handles full teardown.
      trailRef.current = [];
    };
  }, [map, flyToOnFirstFix, trailLength]);

  return null;
}
