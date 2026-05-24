'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
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

function makeHandleEl(): HTMLDivElement {
  const el = document.createElement('div');
  el.style.cssText =
    'width:14px;height:14px;background:#fbbf24;border:2px solid #1e293b;' +
    'border-radius:3px;cursor:nwse-resize;box-shadow:0 0 0 1px rgba(0,0,0,0.4);';
  return el;
}

/** The "fetch this region" button anchored at the box's top-left corner.
 *  Clicking it starts the refresh; dragging the box cancels any in-flight one. */
function makeFetchButtonEl(): HTMLButtonElement {
  const el = document.createElement('button');
  el.type = 'button';
  el.title = 'Fetch forecast for this region';
  el.setAttribute('aria-label', 'Fetch forecast for this region');
  el.textContent = '↻';
  el.style.cssText =
    'width:24px;height:24px;line-height:22px;text-align:center;font-size:15px;' +
    'background:#fbbf24;color:#1e293b;border:1px solid #b45309;border-radius:4px;' +
    'cursor:pointer;box-shadow:0 1px 3px rgba(0,0,0,0.4);padding:0;';
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
 * Always-visible draggable forecast ROI overlay: an amber outline (no fill)
 * with 4 corner handles and a ↻ "fetch this region" button at the top-left.
 * Dragging a handle resizes the box live and persists it to /api/settings on
 * release; it also cancels any in-flight transfer (DELETE /api/forecast/refresh)
 * but does NOT auto-fetch — the user starts a transfer with the ↻ button. A
 * progress strip along the top edge fills west→east as grids land (polled from
 * GET /api/forecast/refresh).
 *
 * Cross-chart sync: listens on the `forecast-cache` BroadcastChannel so other
 * tabs that complete a refresh tell us to re-read settings.
 */
export function ForecastRoi({ map, defaultBbox, hidden = false }: ForecastRoiProps) {
  const [bbox, setBbox] = useState<Bbox | null>(null);
  const [status, setStatus] = useState<'idle' | 'saving' | 'refreshing' | 'error'>('idle');
  const [statusText, setStatusText] = useState<string | null>(null);
  // Refresh progress 0..1 while a background fetch runs; null when idle (bar
  // hidden). Driven by polling GET /api/forecast/refresh.
  const [progress, setProgress] = useState<number | null>(null);
  // The ↻ fetch button shows only when a fetch would get new data: the box was
  // changed since the last fetch (boxDirty), OR a newer model run is available
  // than what's cached for this box (newerAvailable, from the manifest).
  const [boxDirty, setBoxDirty] = useState(false);
  const [newerAvailable, setNewerAvailable] = useState(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const markersRef = useRef<Record<Corner, maplibregl.Marker> | null>(null);
  const fetchBtnRef = useRef<maplibregl.Marker | null>(null);
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

  // Is a newer model run available than what's cached for the current box?
  // Compares the manifest's latest-available run per model to the newest cached
  // run for this exact bbox. Drives the ↻ button alongside boxDirty.
  const checkNewerAvailable = useCallback(async (): Promise<void> => {
    const b = bboxRef.current;
    if (!b) return;
    try {
      const r = await fetch('/api/forecast/manifest', { cache: 'no-store' });
      const j = (await r.json()) as {
        ok?: boolean;
        entries?: Array<{ model: string; runAt: number; bbox: Bbox }>;
        availability?: Record<string, { latestRunUnix: number }>;
      };
      if (!j.ok) return;
      const near = (x: number, y: number): boolean => Math.abs(x - y) < 0.01;
      const matches = (e: { bbox: Bbox }): boolean =>
        near(e.bbox.latMin, b.latMin) &&
        near(e.bbox.latMax, b.latMax) &&
        near(e.bbox.lonMin, b.lonMin) &&
        near(e.bbox.lonMax, b.lonMax);
      let newer = false;
      for (const m of ['gfs', 'ecmwf'] as const) {
        const avail = j.availability?.[m]?.latestRunUnix ?? 0;
        const cachedRuns = (j.entries ?? [])
          .filter((e) => e.model === m && matches(e))
          .map((e) => e.runAt);
        const cachedLatest = cachedRuns.length ? Math.max(...cachedRuns) : 0;
        if (avail > cachedLatest) {
          newer = true;
          break;
        }
      }
      setNewerAvailable(newer);
    } catch {
      /* transient — leave the last value */
    }
  }, []);

  // Re-check on box change + every 60 s (a new run publishes ~every 6 h).
  useEffect(() => {
    void checkNewerAvailable();
    const id = setInterval(() => void checkNewerAvailable(), 60_000);
    return () => clearInterval(id);
  }, [checkNewerAvailable, bbox]);

  // Stop the progress poll on unmount.
  useEffect(() => {
    const poll = pollRef;
    return () => {
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
        // Corner drag handles follow `hidden` (model 'none'/'cmems' → no ROI).
        if (markersRef.current) {
          for (const c of CORNERS)
            markersRef.current[c].getElement().style.display = hidden ? 'none' : '';
        }
        const btnEl = fetchBtnRef.current?.getElement();
        // Hidden while a fetch runs (progress != null); else shown when the box
        // changed or a newer run is available.
        if (btnEl)
          btnEl.style.display =
            !hidden && progress == null && (boxDirty || newerAvailable) ? 'inline-block' : 'none';
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
  }, [map, hidden, progress, bbox, boxDirty, newerAvailable]);

  // Corner markers. Created/torn-down with the map; their positions are
  // updated imperatively on every render via setLngLat (cheap).
  useEffect(() => {
    if (!map) return;
    const corners: Record<Corner, maplibregl.Marker> = {} as Record<Corner, maplibregl.Marker>;
    for (const c of CORNERS) {
      const el = makeHandleEl();
      // Different cursors for diagonal vs anti-diagonal corners.
      if (c === 'sw' || c === 'ne') el.style.cursor = 'nesw-resize';
      if (hidden) el.style.display = 'none';
      const marker = new maplibregl.Marker({ element: el, draggable: true });
      marker.setLngLat([0, 0]).addTo(map);
      marker.on('dragstart', () => {
        draggingRef.current = true;
        // The box is changing, so any in-flight transfer is now stale: cancel
        // it on the server (aborts the downloads) and clear the bar locally.
        // No auto-refetch — the user re-initiates with the ↻ button.
        if (pollRef.current) {
          clearInterval(pollRef.current);
          pollRef.current = null;
        }
        setProgress(null);
        setBoxDirty(true); // box is changing → offer a fetch again
        void fetch('/api/forecast/refresh', { method: 'DELETE' }).catch(() => {});
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
        fetchBtnRef.current?.setLngLat([next.lonMin, next.latMax]);
      });
      marker.on('dragend', () => {
        draggingRef.current = false;
        const final = bboxRef.current;
        if (!final) return;
        setBbox(final);
        // Persist the new box (no auto-fetch). Skip the PUT on a no-move click.
        if (lastCommittedRef.current && bboxesEqual(lastCommittedRef.current, final)) {
          return;
        }
        void persistBbox(final);
      });
      corners[c] = marker;
    }
    markersRef.current = corners;

    // "Fetch this region" button, anchored just inside the top-left corner
    // (offset clears the NW drag handle). Click → start the refresh for the
    // current box. Not draggable.
    const btnEl = makeFetchButtonEl();
    btnEl.addEventListener('click', (e) => {
      e.stopPropagation();
      const b = bboxRef.current;
      if (b) void doRefresh(b);
    });
    btnEl.style.display = (boxDirty || newerAvailable) && !hidden ? 'inline-block' : 'none';
    const fetchBtn = new maplibregl.Marker({
      element: btnEl,
      anchor: 'top-left',
      offset: [12, 12],
    });
    fetchBtn.setLngLat([0, 0]).addTo(map);
    fetchBtnRef.current = fetchBtn;

    // Position immediately from the current bbox. The [bbox] effect below
    // handles later changes, but if bbox was already set before these markers
    // were created (map became ready after the first fix), that effect already
    // ran and won't re-fire — so without this the handles stay at [0,0]
    // (off-screen) and only the outline shows.
    if (bboxRef.current) {
      positionMarkers(corners, bboxRef.current);
      fetchBtn.setLngLat([bboxRef.current.lonMin, bboxRef.current.latMax]);
    }
    return () => {
      for (const c of CORNERS) corners[c].remove();
      fetchBtn.remove();
      markersRef.current = null;
      fetchBtnRef.current = null;
    };
  }, [map]);

  // Whenever React's bbox changes (initial load, programmatic update),
  // realign the corner handles + fetch button.
  useEffect(() => {
    if (!bbox) return;
    if (markersRef.current) positionMarkers(markersRef.current, bbox);
    fetchBtnRef.current?.setLngLat([bbox.lonMin, bbox.latMax]);
  }, [bbox]);

  // BroadcastChannel sync — when a refresh completes (here or another tab),
  // re-read settings and re-check whether a newer run is available.
  useEffect(() => {
    if (typeof BroadcastChannel === 'undefined') return;
    const bc = new BroadcastChannel('forecast-cache');
    bc.onmessage = () => {
      void checkNewerAvailable();
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
  }, [checkNewerAvailable]);

  // Persist the box to settings (Pi auto-refresh + page reload read it). No
  // auto-fetch — the user starts a transfer with the ↻ button.
  const persistBbox = async (next: Bbox): Promise<void> => {
    lastCommittedRef.current = next;
    try {
      const prev = (await (await fetch('/api/settings')).json())?.settings ?? {};
      const put = await fetch('/api/settings', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ ...prev, forecastBbox: next }),
      });
      if (!put.ok) throw new Error(`HTTP ${put.status}`);
    } catch (e) {
      setStatus('error');
      setStatusText(`save failed: ${String(e)}`);
    }
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
    setBoxDirty(false);
    setNewerAvailable(false); // we're fetching the current run for this box now
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
            void checkNewerAvailable(); // cache now current → keep button hidden
          }
        } catch {
          /* transient poll failure — keep polling */
        }
      })();
    }, 2000);
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
