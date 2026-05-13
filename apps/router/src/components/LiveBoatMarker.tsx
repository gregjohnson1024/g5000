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
}

const TRAIL_SOURCE_ID = 'live-trail';
const TRAIL_LAYER_ID = 'live-trail-layer';

/**
 * Trail strategy: hydrate from `/api/tracks/active` on mount (so a page
 * reload preserves the breadcrumb across all of the active recording),
 * then append live `/api/live/position` fixes on top. A
 * `BroadcastChannel('tracks')` listener triggers a re-fetch when the
 * /tracks page interrupts the active recording, so the chart drops the
 * previous breadcrumb and starts a fresh line for the new track.
 */
export function LiveBoatMarker({
  map,
  flyToOnFirstFix = true,
  onUpdate,
}: LiveBoatMarkerProps) {
  const markerRef = useRef<maplibregl.Marker | null>(null);
  const flownRef = useRef<boolean>(false);
  const trailRef = useRef<Array<[number, number]>>([]);
  const activeTrackIdRef = useRef<string | null>(null);
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

    // Hydrate from the active track on disk. Replaces the prior in-memory
    // ring-buffer behavior so reloading the chart doesn't lose history.
    const hydrate = async (): Promise<void> => {
      try {
        const r = await fetch('/api/tracks/active', { cache: 'no-store' });
        const j = await r.json();
        if (!j.ok || !j.track) return;
        activeTrackIdRef.current = j.track.id;
        trailRef.current = (j.track.points as Array<{ lat: number; lon: number }>).map(
          (p) => [p.lon, p.lat] as [number, number],
        );
        updateTrail();
      } catch {
        /* server may not be ready — fall back to live-only appending */
      }
    };
    void hydrate();

    // Re-hydrate when /tracks page interrupts the active recording.
    const bc =
      typeof BroadcastChannel !== 'undefined' ? new BroadcastChannel('tracks') : null;
    bc?.addEventListener('message', (e) => {
      const m = e.data as { kind?: string } | null;
      if (m?.kind === 'interrupted') {
        // Drop the old breadcrumb, start a fresh line, then hydrate.
        trailRef.current = [];
        updateTrail();
        void hydrate();
      }
    });

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
        // Append to in-memory trail. The server-side recorder writes its
        // own down-sampled copy to disk; we don't reach back to /api/tracks
        // on every fix. On reload, hydrate() picks up the persisted copy.
        const last = trailRef.current[trailRef.current.length - 1];
        const moved =
          !last || Math.abs(last[0] - p.lon) > 1e-5 || Math.abs(last[1] - p.lat) > 1e-5;
        if (moved) {
          trailRef.current.push([p.lon, p.lat]);
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
      bc?.close();
      try {
        marker.remove();
      } catch {
        /* map already torn down */
      }
      markerRef.current = null;
      trailRef.current = [];
    };
  }, [map, flyToOnFirstFix]);

  return null;
}
