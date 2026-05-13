'use client';
import { useEffect, useRef } from 'react';
import maplibregl from 'maplibre-gl';

interface LivePos {
  lat: number;
  lon: number;
  cog: number | null;
  sog: number | null;
  t: number;
}

export interface LiveBoatMarkerProps {
  /** Map instance from `onLoad`. Pass `null` until the map is ready. */
  map: maplibregl.Map | null;
  /** When true, flies the map to the boat on first fix. Default true. */
  flyToOnFirstFix?: boolean;
}

/**
 * Subscribes to `/api/live/position` (SSE proxied from the autopilot-server)
 * and renders a triangle marker on the map at the boat's latest position.
 * The marker rotates to match COG when COG is available.
 *
 * Re-renders cheaply — no React state for the marker itself, the maplibre
 * marker is mutated directly on each fix to avoid re-creating DOM nodes.
 */
export function LiveBoatMarker({ map, flyToOnFirstFix = true }: LiveBoatMarkerProps) {
  const markerRef = useRef<maplibregl.Marker | null>(null);
  const flownRef = useRef<boolean>(false);

  useEffect(() => {
    if (!map) return;

    // Build a small svg triangle pointing up (north). We rotate the marker
    // to match COG when fixes carry it.
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
        if (!flownRef.current && flyToOnFirstFix) {
          flownRef.current = true;
          map.flyTo({ center: [p.lon, p.lat], zoom: 9, speed: 1.2 });
        }
      } catch {
        /* ignore parse errors */
      }
    };

    return () => {
      es.close();
      marker.remove();
      markerRef.current = null;
    };
  }, [map, flyToOnFirstFix]);

  return null;
}
