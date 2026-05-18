'use client';

import { useEffect, useRef, useState } from 'react';
import maplibregl from 'maplibre-gl';

const SOURCE_ID = 'forecast-roi-source';
const FILL_LAYER_ID = 'forecast-roi-fill';
const OUTLINE_LAYER_ID = 'forecast-roi-outline';

interface Bbox {
  latMin: number;
  latMax: number;
  lonMin: number;
  lonMax: number;
}

type Corner = 'sw' | 'se' | 'ne' | 'nw';

const CORNERS: Corner[] = ['sw', 'se', 'ne', 'nw'];

/** Forecast hours fetched on every refresh. Mirrors /forecast page so a
 *  ROI resize on /chart yields the same depth of forecast as the manual
 *  refresh from /forecast. */
const REFRESH_HOURS: number[] = Array.from({ length: 57 }, (_, i) => i * 3);
const REFRESH_MODELS = ['gfs', 'ecmwf'] as const;

/** Wait this long after the last drag completes before firing the refresh.
 *  Lets the user nudge several corners without firing redundant fetches. */
const REFRESH_DEBOUNCE_MS = 4000;

function cornersFromBbox(b: Bbox): Record<Corner, [number, number]> {
  return {
    sw: [b.lonMin, b.latMin],
    se: [b.lonMax, b.latMin],
    ne: [b.lonMax, b.latMax],
    nw: [b.lonMin, b.latMax],
  };
}

function polygonFromBbox(b: Bbox): GeoJSON.Feature<GeoJSON.Polygon> {
  return {
    type: 'Feature',
    properties: {},
    geometry: {
      type: 'Polygon',
      coordinates: [
        [
          [b.lonMin, b.latMin],
          [b.lonMax, b.latMin],
          [b.lonMax, b.latMax],
          [b.lonMin, b.latMax],
          [b.lonMin, b.latMin],
        ],
      ],
    },
  };
}

function makeHandleEl(): HTMLDivElement {
  const el = document.createElement('div');
  el.style.cssText =
    'width:14px;height:14px;background:#fbbf24;border:2px solid #1e293b;' +
    'border-radius:3px;cursor:nwse-resize;box-shadow:0 0 0 1px rgba(0,0,0,0.4);';
  return el;
}

interface ForecastRoiProps {
  map: maplibregl.Map | null;
  /** Optional fallback bbox to seed the ROI when /api/settings has none.
   *  Typically a small box around the boat's current position. */
  defaultBbox?: Bbox;
}

/**
 * Always-visible draggable forecast ROI overlay. Renders a transparent
 * amber rectangle on the chart with 4 corner handles. Dragging a handle
 * resizes the bbox live; on dragend the new bbox is persisted to
 * /api/settings and a /api/forecast/refresh kicks off (debounced so a
 * burst of nudges fires one fetch).
 *
 * Cross-chart sync: listens on the `forecast-cache` BroadcastChannel so
 * other tabs that complete a refresh tell us to re-read settings. We
 * don't write to that channel ourselves — only refresh handlers do.
 */
export function ForecastRoi({ map, defaultBbox }: ForecastRoiProps) {
  const [bbox, setBbox] = useState<Bbox | null>(null);
  const [status, setStatus] = useState<'idle' | 'saving' | 'refreshing' | 'error'>('idle');
  const [statusText, setStatusText] = useState<string | null>(null);
  const markersRef = useRef<Record<Corner, maplibregl.Marker> | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const inFlightRef = useRef<AbortController | null>(null);
  const bboxRef = useRef<Bbox | null>(null);

  // Load initial bbox from /api/settings. If none, optionally seed from
  // defaultBbox so the user has something to grab. Seeding does NOT
  // persist — it stays an in-memory placeholder until the user drags.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const r = await fetch('/api/settings', { cache: 'no-store' });
        const j = (await r.json()) as { settings?: { forecastBbox?: Bbox } };
        if (cancelled) return;
        if (j.settings?.forecastBbox) {
          setBbox(j.settings.forecastBbox);
        } else if (defaultBbox) {
          setBbox(defaultBbox);
        }
      } catch {
        if (!cancelled && defaultBbox) setBbox(defaultBbox);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [defaultBbox]);

  // Track bbox in a ref for handle drag handlers (they capture once at
  // marker creation and would otherwise see stale state).
  useEffect(() => {
    bboxRef.current = bbox;
  }, [bbox]);

  // Layer + source lifecycle. Created once when the map is ready; data
  // updated on every bbox change. Torn down on unmount.
  useEffect(() => {
    if (!map || !bbox) return;
    const setup = (): void => {
      if (!map.isStyleLoaded()) return;
      if (!map.getSource(SOURCE_ID)) {
        map.addSource(SOURCE_ID, {
          type: 'geojson',
          data: polygonFromBbox(bbox),
        });
      }
      if (!map.getLayer(FILL_LAYER_ID)) {
        map.addLayer({
          id: FILL_LAYER_ID,
          type: 'fill',
          source: SOURCE_ID,
          paint: {
            'fill-color': '#fbbf24',
            'fill-opacity': 0.08,
          },
        });
      }
      if (!map.getLayer(OUTLINE_LAYER_ID)) {
        map.addLayer({
          id: OUTLINE_LAYER_ID,
          type: 'line',
          source: SOURCE_ID,
          paint: {
            'line-color': '#fbbf24',
            'line-width': 1.5,
            'line-opacity': 0.7,
            'line-dasharray': [4, 3],
          },
        });
      }
    };
    setup();
    map.on('styledata', setup);
    return () => {
      map.off('styledata', setup);
    };
  }, [map, bbox]);

  // Push polygon updates to the source whenever bbox changes (drag-in-
  // progress + persisted state).
  useEffect(() => {
    if (!map || !bbox) return;
    const src = map.getSource(SOURCE_ID) as maplibregl.GeoJSONSource | undefined;
    if (src) src.setData(polygonFromBbox(bbox));
  }, [map, bbox]);

  // Corner markers. Created/torn-down with the map; their positions are
  // updated imperatively on every render via setLngLat (cheap).
  useEffect(() => {
    if (!map) return;
    const corners: Record<Corner, maplibregl.Marker> = {} as Record<Corner, maplibregl.Marker>;
    for (const c of CORNERS) {
      const el = makeHandleEl();
      // Different cursors for diagonal vs anti-diagonal corners.
      if (c === 'sw' || c === 'ne') el.style.cursor = 'nesw-resize';
      const marker = new maplibregl.Marker({ element: el, draggable: true });
      marker.setLngLat([0, 0]).addTo(map);
      marker.on('drag', () => {
        const lngLat = marker.getLngLat();
        const cur = bboxRef.current;
        if (!cur) return;
        const next = updateCorner(cur, c, lngLat);
        bboxRef.current = next;
        // Live-update the polygon without React state churn — state catches
        // up on dragend so consumers see the final committed bbox.
        const src = map.getSource(SOURCE_ID) as maplibregl.GeoJSONSource | undefined;
        if (src) src.setData(polygonFromBbox(next));
        // Snap sibling markers so they track the resizing corner.
        positionMarkers(corners, next);
      });
      marker.on('dragend', () => {
        const final = bboxRef.current;
        if (!final) return;
        setBbox(final);
        void commitBbox(final);
      });
      corners[c] = marker;
    }
    markersRef.current = corners;
    return () => {
      for (const c of CORNERS) corners[c].remove();
      markersRef.current = null;
    };
  }, [map]);

  // Whenever React's bbox changes (initial load, programmatic update),
  // realign markers.
  useEffect(() => {
    if (!markersRef.current || !bbox) return;
    positionMarkers(markersRef.current, bbox);
  }, [bbox]);

  // BroadcastChannel sync — when another tab finishes a refresh, re-read
  // settings in case the bbox was updated there.
  useEffect(() => {
    if (typeof BroadcastChannel === 'undefined') return;
    const bc = new BroadcastChannel('forecast-cache');
    bc.onmessage = () => {
      void (async () => {
        try {
          const r = await fetch('/api/settings', { cache: 'no-store' });
          const j = (await r.json()) as { settings?: { forecastBbox?: Bbox } };
          if (j.settings?.forecastBbox) setBbox(j.settings.forecastBbox);
        } catch {
          /* transient */
        }
      })();
    };
    return () => bc.close();
  }, []);

  const commitBbox = async (next: Bbox): Promise<void> => {
    setStatus('saving');
    setStatusText('saving ROI…');
    try {
      const r = await fetch('/api/settings');
      const prev = (await r.json())?.settings ?? {};
      const put = await fetch('/api/settings', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ ...prev, forecastBbox: next }),
      });
      if (!put.ok) throw new Error(`HTTP ${put.status}`);
    } catch (e) {
      setStatus('error');
      setStatusText(`save failed: ${String(e)}`);
      return;
    }
    setStatus('idle');
    setStatusText(null);
    scheduleRefresh(next);
  };

  const scheduleRefresh = (next: Bbox): void => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    setStatusText(`refresh in ${(REFRESH_DEBOUNCE_MS / 1000) | 0} s…`);
    debounceRef.current = setTimeout(() => {
      debounceRef.current = null;
      void doRefresh(next);
    }, REFRESH_DEBOUNCE_MS);
  };

  const doRefresh = async (next: Bbox): Promise<void> => {
    // Abort any in-flight refresh — the user's new ROI supersedes it.
    if (inFlightRef.current) {
      inFlightRef.current.abort();
      inFlightRef.current = null;
    }
    const ctrl = new AbortController();
    inFlightRef.current = ctrl;
    setStatus('refreshing');
    setStatusText('refreshing models…');
    try {
      const r = await fetch('/api/forecast/refresh', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          bbox: next,
          models: REFRESH_MODELS,
          hours: REFRESH_HOURS,
        }),
        signal: ctrl.signal,
      });
      if (ctrl.signal.aborted) return;
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const j = (await r.json()) as { ok?: boolean; pruned?: number };
      setStatus('idle');
      setStatusText(
        j.pruned && j.pruned > 0 ? `models refreshed (pruned ${j.pruned} stale)` : 'models refreshed',
      );
      // Tell siblings (forecast page badge, etc.) to re-read the manifest.
      if (typeof BroadcastChannel !== 'undefined') {
        const bc = new BroadcastChannel('forecast-cache');
        bc.postMessage({ kind: 'fetch-complete', at: Date.now() });
        bc.close();
      }
      setTimeout(() => setStatusText(null), 4000);
    } catch (e) {
      if (ctrl.signal.aborted) return;
      setStatus('error');
      setStatusText(`refresh failed: ${String(e)}`);
    } finally {
      if (inFlightRef.current === ctrl) inFlightRef.current = null;
    }
  };

  if (!bbox) return null;
  return (
    <div className="absolute top-3 left-1/2 -translate-x-1/2 z-10 pointer-events-none">
      {statusText && (
        <div
          className={`px-3 py-1.5 rounded shadow text-xs font-mono border ${
            status === 'error'
              ? 'bg-red-900/90 border-red-700 text-red-200'
              : status === 'refreshing'
                ? 'bg-amber-900/90 border-amber-700 text-amber-100'
                : 'bg-slate-900/90 border-slate-700 text-slate-200'
          }`}
        >
          {statusText}
        </div>
      )}
    </div>
  );
}

function updateCorner(b: Bbox, c: Corner, lngLat: maplibregl.LngLat): Bbox {
  // Map each corner to which (lat, lon) extremum it owns. The 4-marker
  // model lets the user freely drag corners "past" each other; we always
  // re-normalize to canonical min/max so downstream consumers see a
  // well-formed bbox.
  const corners: Record<Corner, { lat: number; lon: number }> = {
    sw: { lat: b.latMin, lon: b.lonMin },
    se: { lat: b.latMin, lon: b.lonMax },
    ne: { lat: b.latMax, lon: b.lonMax },
    nw: { lat: b.latMax, lon: b.lonMin },
  };
  corners[c] = { lat: lngLat.lat, lon: lngLat.lng };
  // Re-derive the bbox from whichever corner is now the extremum.
  // (Dragging "SW" past "NE" just flips the rectangle inside-out and
  // the new min/max reflect the post-flip geometry.)
  const lats = Object.values(corners).map((p) => p.lat);
  const lons = Object.values(corners).map((p) => p.lon);
  return {
    latMin: Math.min(...lats),
    latMax: Math.max(...lats),
    lonMin: Math.min(...lons),
    lonMax: Math.max(...lons),
  };
}

function positionMarkers(
  markers: Record<Corner, maplibregl.Marker>,
  bbox: Bbox,
): void {
  const positions = cornersFromBbox(bbox);
  for (const c of CORNERS) {
    markers[c].setLngLat(positions[c]);
  }
}
