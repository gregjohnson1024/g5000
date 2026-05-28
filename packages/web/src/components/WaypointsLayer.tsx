'use client';
import { useEffect, useRef } from 'react';
import maplibregl from 'maplibre-gl';

export interface MarkLike {
  /** Waypoint id, when this mark is a saved waypoint (enables selection). */
  id?: string;
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
  onSelectWaypoint,
  onMoveWaypoint,
}: {
  map: maplibregl.Map | null;
  marks: MarkLike[];
  /** Called with the waypoint id when a dot is clicked. Pass undefined to
   * disable selection (e.g. while waypoint-drop mode is active). */
  onSelectWaypoint?: (id: string) => void;
  /** Called when a dot is dragged to a new position and released. Pass
   * undefined to disable dragging. A drag suppresses the click-to-select. */
  onMoveWaypoint?: (id: string, lat: number, lon: number) => void;
}) {
  // Persistent across re-renders so the marks-change effect can update
  // labels without tearing down the layer.
  const labelMarkersRef = useRef<Map<string, maplibregl.Marker>>(new Map());
  const marksRef = useRef<MarkLike[]>(marks);
  const syncRef = useRef<(() => void) | null>(null);
  marksRef.current = marks;
  const onSelectRef = useRef<((id: string) => void) | undefined>(onSelectWaypoint);
  onSelectRef.current = onSelectWaypoint;
  const onMoveRef = useRef<((id: string, lat: number, lon: number) => void) | undefined>(
    onMoveWaypoint,
  );
  onMoveRef.current = onMoveWaypoint;
  // Drag state. `drag` is the in-progress drag; `dragOverride` is the live
  // preview position applied in sync(); `suppressClick` swallows the click
  // MapLibre fires after a drag so it doesn't also open the edit popup.
  const dragRef = useRef<{ id: string; moved: boolean; startX: number; startY: number } | null>(
    null,
  );
  const dragOverrideRef = useRef<{ id: string; lat: number; lon: number } | null>(null);
  const suppressClickRef = useRef(false);

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
            // Start = green, End = red (route endpoints), else default amber.
            'circle-color': ['match', ['get', 'badge'], 'S', '#22c55e', 'E', '#ef4444', '#fbbf24'],
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
      // While a dot is being dragged, render it at the live cursor position.
      const ov = dragOverrideRef.current;
      const lonOf = (m: MarkLike): number => (ov && m.id === ov.id ? ov.lon : m.lon);
      const latOf = (m: MarkLike): number => (ov && m.id === ov.id ? ov.lat : m.lat);
      const features = currentMarks
        .filter((m) => Number.isFinite(m.lat) && Number.isFinite(m.lon))
        .map((m, i) => ({
          type: 'Feature' as const,
          geometry: { type: 'Point' as const, coordinates: [lonOf(m), latOf(m)] },
          properties: {
            id: m.id ?? `${i}`,
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
        // Key labels by id when available so a moving (dragged) dot keeps the
        // same label marker instead of churning a new one each frame.
        const key = m.id ?? `${m.lat.toFixed(5)},${m.lon.toFixed(5)}`;
        live.add(key);
        const label =
          m.badge === 'S'
            ? `S — ${m.name ?? ''}`
            : m.badge === 'E'
              ? `E — ${m.name ?? ''}`
              : (m.name ?? '');
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
          mk.setLngLat([lonOf(m), latOf(m)]).addTo(map);
          labelMarkers.set(key, mk);
        } else {
          mk.setLngLat([lonOf(m), latOf(m)]);
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

    const onDotClick = (e: maplibregl.MapLayerMouseEvent): void => {
      // A drag fires a click on release — swallow it so the move doesn't also
      // open the edit popup.
      if (suppressClickRef.current) {
        suppressClickRef.current = false;
        return;
      }
      const id = e.features?.[0]?.properties?.id;
      if (typeof id === 'string' && onSelectRef.current) onSelectRef.current(id);
    };
    const onEnter = (): void => {
      if (onSelectRef.current || onMoveRef.current) map.getCanvas().style.cursor = 'pointer';
    };
    const onLeave = (): void => {
      if (!dragRef.current) map.getCanvas().style.cursor = '';
    };
    const onDotMouseDown = (e: maplibregl.MapLayerMouseEvent): void => {
      if (!onMoveRef.current) return;
      const f = e.features?.[0];
      const id = f?.properties?.id;
      // Drag any saved waypoint, including the badged route start/end ones.
      if (typeof id !== 'string') return;
      e.preventDefault(); // stop the map from starting a pan
      map.dragPan.disable();
      dragRef.current = { id, moved: false, startX: e.point.x, startY: e.point.y };
      dragOverrideRef.current = null;
      map.getCanvas().style.cursor = 'move'; // 4-way move arrow
    };
    const onMouseMove = (e: maplibregl.MapMouseEvent): void => {
      const d = dragRef.current;
      if (!d) return;
      // Ignore sub-threshold jitter so a plain click stays a click (select),
      // not a (no-op) drag.
      if (!d.moved && Math.hypot(e.point.x - d.startX, e.point.y - d.startY) < 3) return;
      d.moved = true;
      dragOverrideRef.current = { id: d.id, lat: e.lngLat.lat, lon: e.lngLat.lng };
      sync();
    };
    const onMouseUp = (): void => {
      const d = dragRef.current;
      if (!d) return;
      dragRef.current = null;
      map.dragPan.enable();
      map.getCanvas().style.cursor = onSelectRef.current || onMoveRef.current ? 'pointer' : '';
      const ov = dragOverrideRef.current;
      if (d.moved && ov && onMoveRef.current) {
        suppressClickRef.current = true; // swallow the trailing click
        onMoveRef.current(d.id, ov.lat, ov.lon);
        sync(); // render at drop position while override is still set
        dragOverrideRef.current = null;
      } else {
        dragOverrideRef.current = null;
        sync();
      }
    };
    map.on('click', DOT_LAYER, onDotClick);
    map.on('mousedown', DOT_LAYER, onDotMouseDown);
    map.on('mousemove', onMouseMove);
    map.on('mouseup', onMouseUp);
    map.on('mouseenter', DOT_LAYER, onEnter);
    map.on('mouseleave', DOT_LAYER, onLeave);

    return () => {
      map.off('click', DOT_LAYER, onDotClick);
      map.off('mousedown', DOT_LAYER, onDotMouseDown);
      map.off('mousemove', onMouseMove);
      map.off('mouseup', onMouseUp);
      map.off('mouseenter', DOT_LAYER, onEnter);
      map.off('mouseleave', DOT_LAYER, onLeave);
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
