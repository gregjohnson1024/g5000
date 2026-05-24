'use client';

import { useEffect, useRef, useState } from 'react';
import maplibregl from 'maplibre-gl';
import {
  bboxesEqual,
  cornersFromBbox,
  CORNERS,
  polygonFromBbox,
  topEdgeLine,
  updateCorner,
  type Bbox,
  type Corner,
} from './forecast-roi-math';

const SOURCE_ID = 'forecast-roi-source';
const OUTLINE_LAYER_ID = 'forecast-roi-outline';
// Refresh progress bar — a strip along the box's top edge: a faint full-width
// track and a bright fill that grows west→east with fetch completion.
const PROGRESS_TRACK_SOURCE = 'forecast-roi-progress-track';
const PROGRESS_FILL_SOURCE = 'forecast-roi-progress-fill';
const PROGRESS_TRACK_LAYER = 'forecast-roi-progress-track-line';
const PROGRESS_FILL_LAYER = 'forecast-roi-progress-fill-line';

/** Forecast hours fetched on every refresh. Mirrors /forecast page so a
 *  ROI resize on /chart yields the same depth of forecast as the manual
 *  refresh from /forecast. */
const REFRESH_HOURS: number[] = Array.from({ length: 57 }, (_, i) => i * 3);
const REFRESH_MODELS = ['gfs', 'ecmwf'] as const;

/** Wait this long after the last drag completes before firing the refresh.
 *  Lets the user nudge several corners without firing redundant fetches. */
const REFRESH_DEBOUNCE_MS = 4000;

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
  /** Hide the overlay when true; show when false. Defaults to false. */
  hidden?: boolean;
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
export function ForecastRoi({ map, defaultBbox, hidden = false }: ForecastRoiProps) {
  const [bbox, setBbox] = useState<Bbox | null>(null);
  const [status, setStatus] = useState<'idle' | 'saving' | 'refreshing' | 'error'>('idle');
  const [statusText, setStatusText] = useState<string | null>(null);
  // Refresh progress 0..1 while a background fetch runs; null when idle (bar
  // hidden). Driven by polling GET /api/forecast/refresh.
  const [progress, setProgress] = useState<number | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const markersRef = useRef<Record<Corner, maplibregl.Marker> | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const bboxRef = useRef<Bbox | null>(null);
  /** Last bbox that we successfully PUT to /api/settings. Used to short-
   *  circuit a misclick-without-drag dragend that would otherwise trigger
   *  a full model refresh against an unchanged bbox. */
  const lastCommittedRef = useRef<Bbox | null>(null);
  /** True once we've seeded the bbox (from settings or defaultBbox). The seed
   *  must happen ONCE — `defaultBbox` is derived from the live GPS fix, so it's
   *  a new object ~1 Hz; re-running the loader would call setBbox() mid-drag,
   *  flicker the box back to the persisted value, and clobber bboxRef so the
   *  drag reverts on release. */
  const loadedRef = useRef(false);
  /** True while a corner handle is being dragged — blocks any setBbox() from
   *  the loader / cross-tab listener so the in-progress drag isn't reset. */
  const draggingRef = useRef(false);

  // Load initial bbox from /api/settings. If none, seed from defaultBbox once
  // it's available. Seeding does NOT persist — it stays an in-memory
  // placeholder until the user drags. Runs effectively once (guarded by
  // loadedRef) even though defaultBbox changes on every GPS fix.
  useEffect(() => {
    if (loadedRef.current) return;
    let cancelled = false;
    void (async () => {
      try {
        const r = await fetch('/api/settings', { cache: 'no-store' });
        const j = (await r.json()) as { settings?: { forecastBbox?: Bbox } };
        if (cancelled || loadedRef.current) return;
        if (j.settings?.forecastBbox) {
          loadedRef.current = true;
          setBbox(j.settings.forecastBbox);
          // Server already has this bbox — seed lastCommittedRef so a
          // misclick (dragend with no movement) doesn't fire a refresh
          // against an unchanged bbox.
          lastCommittedRef.current = j.settings.forecastBbox;
        } else if (defaultBbox) {
          loadedRef.current = true;
          setBbox(defaultBbox);
        }
      } catch {
        if (!cancelled && !loadedRef.current && defaultBbox) {
          loadedRef.current = true;
          setBbox(defaultBbox);
        }
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

  // Clear pending debounce + progress poll on unmount.
  useEffect(() => {
    const debounce = debounceRef;
    const poll = pollRef;
    return () => {
      if (debounce.current) clearTimeout(debounce.current);
      if (poll.current) clearInterval(poll.current);
    };
  }, []);

  // Layer + source lifecycle. Created once the map is ready; data updated on
  // bbox change. Do NOT gate on map.isStyleLoaded() — it can stay false while
  // sources still load, leaving only the marker handles with no outline (the
  // "edges sometimes missing" bug). Wrap in try/catch and retry on styledata.
  useEffect(() => {
    if (!map || !bbox) return;
    const setup = (): void => {
      try {
        if (!map.getSource(SOURCE_ID)) {
          map.addSource(SOURCE_ID, { type: 'geojson', data: polygonFromBbox(bbox) });
        }
        if (!map.getSource(PROGRESS_TRACK_SOURCE)) {
          map.addSource(PROGRESS_TRACK_SOURCE, { type: 'geojson', data: topEdgeLine(bbox, 1) });
        }
        if (!map.getSource(PROGRESS_FILL_SOURCE)) {
          map.addSource(PROGRESS_FILL_SOURCE, { type: 'geojson', data: topEdgeLine(bbox, 0) });
        }
        // Outline only — the box is never filled.
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
        if (!map.getLayer(PROGRESS_TRACK_LAYER)) {
          map.addLayer({
            id: PROGRESS_TRACK_LAYER,
            type: 'line',
            source: PROGRESS_TRACK_SOURCE,
            layout: { visibility: 'none' },
            paint: { 'line-color': '#0f172a', 'line-width': 6, 'line-opacity': 0.45 },
          });
        }
        if (!map.getLayer(PROGRESS_FILL_LAYER)) {
          map.addLayer({
            id: PROGRESS_FILL_LAYER,
            type: 'line',
            source: PROGRESS_FILL_SOURCE,
            layout: { visibility: 'none' },
            paint: { 'line-color': '#34d399', 'line-width': 6 },
          });
        }
      } catch {
        /* style not ready yet — retried on the next styledata */
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

  // Visibility control: outline follows the hidden prop; the progress bar is
  // shown only while a refresh is running (progress != null) and not hidden.
  // Also keeps the progress sources' geometry in sync with the bbox + fill
  // fraction. Re-applied on styledata in case the layers were just (re)created.
  useEffect(() => {
    if (!map) return;
    const apply = (): void => {
      try {
        if (map.getLayer(OUTLINE_LAYER_ID)) {
          map.setLayoutProperty(OUTLINE_LAYER_ID, 'visibility', hidden ? 'none' : 'visible');
        }
        const showBar = !hidden && progress != null;
        const barVis = showBar ? 'visible' : 'none';
        if (map.getLayer(PROGRESS_TRACK_LAYER)) {
          map.setLayoutProperty(PROGRESS_TRACK_LAYER, 'visibility', barVis);
        }
        if (map.getLayer(PROGRESS_FILL_LAYER)) {
          map.setLayoutProperty(PROGRESS_FILL_LAYER, 'visibility', barVis);
        }
        if (bbox) {
          const track = map.getSource(PROGRESS_TRACK_SOURCE) as
            | maplibregl.GeoJSONSource
            | undefined;
          const fill = map.getSource(PROGRESS_FILL_SOURCE) as maplibregl.GeoJSONSource | undefined;
          if (track) track.setData(topEdgeLine(bbox, 1));
          if (fill) fill.setData(topEdgeLine(bbox, progress ?? 0));
        }
      } catch {
        /* map torn down between effects; ignore */
      }
    };
    apply();
    map.on('styledata', apply);
    return () => map.off('styledata', apply);
  }, [map, hidden, progress, bbox]);

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
      marker.on('dragstart', () => {
        draggingRef.current = true;
      });
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
        // Snap sibling markers so they track the resizing corner. Skip the
        // one being dragged — maplibre is already updating its position
        // and writing on top would fight the drag handler.
        positionMarkers(corners, next, c);
      });
      marker.on('dragend', () => {
        draggingRef.current = false;
        const final = bboxRef.current;
        if (!final) return;
        setBbox(final);
        // A click without movement still fires dragend with bbox unchanged.
        // Skip the network calls in that case — otherwise a misclick on a
        // handle pays for a 2-model × 57-hour refresh.
        if (lastCommittedRef.current && bboxesEqual(lastCommittedRef.current, final)) {
          return;
        }
        void commitBbox(final);
      });
      corners[c] = marker;
    }
    markersRef.current = corners;
    // Position immediately from the current bbox. The [bbox] effect below
    // handles later changes, but if bbox was already set before these markers
    // were created (map became ready after the first fix), that effect already
    // ran and won't re-fire — so without this the handles stay at [0,0]
    // (off-screen) and only the outline shows.
    if (bboxRef.current) positionMarkers(corners, bboxRef.current);
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
      if (draggingRef.current) return; // don't reset a box the user is dragging
      void (async () => {
        try {
          const r = await fetch('/api/settings', { cache: 'no-store' });
          const j = (await r.json()) as { settings?: { forecastBbox?: Bbox } };
          if (!draggingRef.current && j.settings?.forecastBbox) setBbox(j.settings.forecastBbox);
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
    lastCommittedRef.current = next;
    setStatus('idle');
    setStatusText(null);
    scheduleRefresh(next);
  };

  const scheduleRefresh = (next: Bbox): void => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      debounceRef.current = null;
      void doRefresh(next);
    }, REFRESH_DEBOUNCE_MS);
  };

  const doRefresh = async (next: Bbox): Promise<void> => {
    // The server runs the fetch as a background job and returns 202 with a job
    // `gen`. We poll GET /api/forecast/refresh to drive the top-edge progress
    // bar and, on each tick, nudge consumers (wind overlay, /forecast) to
    // re-read so grids appear as they land. Older jobs are superseded
    // server-side, so we just re-point the poller at the new gen.
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
    setStatus('refreshing');
    setStatusText(null);
    setProgress(0);
    let myGen: number | undefined;
    try {
      const r = await fetch('/api/forecast/refresh', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ bbox: next, models: REFRESH_MODELS, hours: REFRESH_HOURS }),
      });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      myGen = ((await r.json()) as { gen?: number }).gen;
    } catch (e) {
      setStatus('error');
      setStatusText(`refresh failed: ${String(e)}`);
      setProgress(null);
      return;
    }
    const broadcast = (): void => {
      if (typeof BroadcastChannel === 'undefined') return;
      const bc = new BroadcastChannel('forecast-cache');
      bc.postMessage({ kind: 'fetch-complete', at: Date.now() });
      bc.close();
    };
    const stopPoll = (): void => {
      if (pollRef.current) {
        clearInterval(pollRef.current);
        pollRef.current = null;
      }
    };
    pollRef.current = setInterval(() => {
      void (async () => {
        try {
          const res = await fetch('/api/forecast/refresh', { cache: 'no-store' });
          const p = (await res.json()) as {
            gen: number;
            total: number;
            done: number;
            running: boolean;
          };
          if (myGen != null && p.gen !== myGen) {
            stopPoll(); // a newer refresh now owns the bar
            return;
          }
          setProgress(p.total > 0 ? p.done / p.total : 0);
          broadcast();
          if (!p.running) {
            stopPoll();
            setStatus('idle');
            setProgress(1);
            window.setTimeout(() => setProgress(null), 1500);
          }
        } catch {
          /* transient poll failure — keep polling */
        }
      })();
    }, 3000);
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

function positionMarkers(
  markers: Record<Corner, maplibregl.Marker>,
  bbox: Bbox,
  skip?: Corner,
): void {
  const positions = cornersFromBbox(bbox);
  for (const c of CORNERS) {
    if (c === skip) continue;
    markers[c].setLngLat(positions[c]);
  }
}
