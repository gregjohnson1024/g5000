'use client';
import { Suspense, useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import maplibregl from 'maplibre-gl';
import { Map } from '../../components/Map';
import { StatusBadge } from '../../components/StatusBadge';
import { attachRoute, detachRoute, type RouteColorMode } from '../../components/RoutePolyline';
import { LiveBoatMarker, type LivePos } from '../../components/LiveBoatMarker';
import { AisTargets } from '../../components/AisTargets';
import { ForecastRoi } from '../../components/ForecastRoi';
import { WaypointsLayer } from '../../components/WaypointsLayer';
import { TrackOverlay, type TrackColorMode } from '../../components/TrackOverlay';
import { IsochroneLayer } from '../../components/IsochroneLayer';
import { RouteWindLayer } from '../../components/RouteWindLayer';
import { WaypointEditPopup } from '../../components/WaypointEditPopup';
import { fmtLatLonDmm } from '../../lib/format-coords';
// DriftArrow removed at user's request; computation kept on /helm via the
// shared @g5000/compute helper. If the chart needs set+drift back, prefer
// pulling it from /api/position rather than re-deriving here.
import { WindOverlay, type WindGrid } from '../../components/WindOverlay';
import { WindLegend } from '../../components/WindLegend';
import { CurrentOverlay, type CurrentGrid } from '../../components/CurrentOverlay';
import { sampleUV, type UvGrid } from '../../lib/grid-sample';
import { StartLineLayer } from '../../components/StartLineLayer';
import { LaylinesLayer } from '../../components/LaylinesLayer';
import { EncLayer } from '../../components/EncLayer';
import { SatelliteLayer } from '../../components/SatelliteLayer';
import { EncBuoyLayer } from '../../components/EncBuoyLayer';
import { BathyLayer } from '../../components/BathyLayer';
import { TileLoadingIndicator } from '../../components/TileLoadingIndicator';
import { CogExtension } from '../../components/CogExtension';
import { MapLoadingIndicator } from '../../components/MapLoadingIndicator';
import { type LayersState } from './LayersControl';
import { modelLayerView, type ChartModel } from './model-layer';
import { inHrrrDomain, hrrrHorizonHours, pickHrrrRun } from '../../lib/hrrr-helpers';
import { ChartToolbar } from './ChartToolbar';
import { ChartFollowControl } from './ChartFollowControl';
import { RoutePlanPanel } from './RoutePlanPanel';
import { PlaybackScrubber } from './PlaybackScrubber';
import { RouteDetailsBox } from './RouteDetailsBox';
import { OffscreenVesselIndicator } from './OffscreenVesselIndicator';
import { useChartCamera } from './use-chart-camera';
import { nextWaypointName } from './waypoint-name';
import { TzToggle } from '../../components/TzToggle';
import { fmtHourLabel, readTzMode, writeTzMode, type TzMode } from '../../lib/tz';
import { nearestForecastHour, type PlaybackState } from '../../lib/route-playback';
import type { Route } from '@g5000/routing';
import type { Track } from '../../lib/tracks';

interface TrackLayerPref {
  visible: boolean;
  colorMode: TrackColorMode;
}
/** Shared with /tracks: which saved tracks to draw on the chart and how. */
const TRACK_LAYERS_KEY = 'chart:trackLayers';

/**
 * Minutes of travel projected ahead from each vessel's current position
 * along its COG. Shared between own-boat (CogExtension) and AIS targets
 * (AisTargets) so the chart visually answers "where will everyone be in
 * the next N minutes?" with a single time horizon.
 */
const COG_EXTENSION_MINUTES = 360;

// Full intended forecast set: GFS is hourly to +120 h then 3-hourly to +168 h.
// Matches the refresh job, so the timeline can show how far the cache has
// filled (available vs in-progress).
const WIND_FORECAST_HOURS: number[] = [
  ...Array.from({ length: 121 }, (_, i) => i),
  ...Array.from({ length: 16 }, (_, i) => 123 + i * 3),
];

export default function ChartPage() {
  // Next.js requires useSearchParams() to be wrapped in a Suspense boundary
  // because the search params can suspend during static prerender. This
  // wrapper satisfies that requirement; ChartPageInner does the real work.
  return (
    <Suspense fallback={null}>
      <ChartPageInner />
    </Suspense>
  );
}

function ChartPageInner() {
  const mapRef = useRef<maplibregl.Map | null>(null);
  const [mapInstance, setMapInstance] = useState<maplibregl.Map | null>(null);
  const [livePos, setLivePos] = useState<LivePos | null>(null);
  const camera = useChartCamera({ map: mapInstance, livePos });
  const [windHours, setWindHours] = useState(0);
  // When true, the slider stays pinned to the forecast hour nearest now and
  // advances with the clock; dragging the slider / using ←→ turns it off.
  const [windLockNow, setWindLockNow] = useState(true);
  // Bumped automatically whenever the user moves the timeline / model so the
  // chart re-reads from the cache. Fetching itself happens on /forecast.
  const [windRefreshKey, setWindRefreshKey] = useState(1);
  const [windGrid, setWindGrid] = useState<WindGrid | null>(null);
  const [windStatus, setWindStatus] = useState<string | null>(null);
  // The CMEMS current grid currently displayed, lifted so the cursor readout
  // can sample it (same role as windGrid for the wind overlay).
  const [currentGrid, setCurrentGrid] = useState<CurrentGrid | null>(null);
  // The active forecast ROI box (from /api/settings). Passed to WindOverlay so
  // it only shows grids fetched for this box — keeping it in step with the
  // slider/banner, which key on the same box.
  const [forecastBbox, setForecastBbox] = useState<{
    latMin: number;
    latMax: number;
    lonMin: number;
    lonMax: number;
  } | null>(null);
  const [currentRefreshKey, setCurrentRefreshKey] = useState(1);
  const [currentStatus, setCurrentStatus] = useState<string | null>(null);
  const [availableHours, setAvailableHours] = useState<{
    gfs: number[];
    ecmwf: number[];
    hrrr: number[];
  }>({
    gfs: [],
    ecmwf: [],
    hrrr: [],
  });
  const [latestRunAt, setLatestRunAt] = useState<{
    gfs: number | null;
    ecmwf: number | null;
    hrrr: number | null;
  }>({
    gfs: null,
    ecmwf: null,
    hrrr: null,
  });
  // Lat/lon under the mouse — populated while the cursor is over the map,
  // cleared when it leaves. Used by the bottom-left cursor-position panel
  // (distance + bearing from the live boat fix when available).
  const [cursorLatLon, setCursorLatLon] = useState<{ lat: number; lon: number } | null>(null);
  // Page-level Local/UTC toggle for the forecast timeline label and the
  // Departure picker. Default Local — per user request. Persisted to its
  // own localStorage key (separate from /passage so each page remembers
  // independently).
  const [tz, setTz] = useState<TzMode>('local');
  useEffect(() => {
    setTz(readTzMode('chart:tz', 'local'));
  }, []);
  useEffect(() => {
    writeTzMode('chart:tz', tz);
  }, [tz]);
  // Layer visibility — persists to localStorage so the choice survives
  // reloads. Hydrated AFTER first render (not via lazy `useState` init)
  // so server and client agree on the initial paint — otherwise the
  // popover button text and styling diverge when localStorage has a
  // prior-session value, tripping React 19 hydration enforcement.
  const [layers, setLayers] = useState<LayersState>({
    osm: true,
    enc: false,
    satellite: false,
    buoys: false,
    bathy: false,
    ais: true,
    aisCog: true,
    model: 'none' as ChartModel,
  });
  const [layersHydrated, setLayersHydrated] = useState(false);
  useEffect(() => {
    try {
      const raw = window.localStorage.getItem('chart:layers');
      if (raw) {
        const parsed = JSON.parse(raw) as Partial<LayersState>;
        const validModels: ChartModel[] = ['none', 'gfs', 'ecmwf', 'hrrr', 'cmems'];
        setLayers({
          osm: parsed.osm ?? true,
          enc: parsed.enc ?? false,
          satellite: parsed.satellite ?? false,
          buoys: parsed.buoys ?? false,
          bathy: parsed.bathy ?? false,
          ais: parsed.ais ?? true,
          aisCog: parsed.aisCog ?? true,
          model: validModels.includes(parsed.model as ChartModel)
            ? (parsed.model as ChartModel)
            : 'none',
        });
      }
    } catch {
      /* corrupt JSON / private mode — fall back to defaults */
    }
    setLayersHydrated(true);
  }, []);
  useEffect(() => {
    if (!layersHydrated) return;
    try {
      window.localStorage.setItem('chart:layers', JSON.stringify(layers));
    } catch {
      /* private-mode / quota exceeded — ignore */
    }
  }, [layers, layersHydrated]);

  // Single source of truth for which overlay(s) are visible, derived from
  // the mutually-exclusive layers.model choice.
  const mv = modelLayerView(layers.model);

  // Restore the camera (center + zoom + bearing) from the last time the
  // user was on /chart. Synchronous useState initializer so the Map's
  // first render uses the saved values — no default-zoom flash. Falls
  // back to the western-North-Atlantic overview when nothing is saved
  // (first ever visit, or localStorage cleared).
  const [initialCamera] = useState<{ lat: number; lon: number; zoom: number; bearing: number }>(
    () => {
      const fallback = { lat: 35, lon: -70, zoom: 4, bearing: 0 };
      if (typeof window === 'undefined') return fallback;
      try {
        const raw = window.localStorage.getItem('chart:camera');
        if (!raw) return fallback;
        const c = JSON.parse(raw) as Partial<typeof fallback>;
        if (
          typeof c.lat === 'number' &&
          Number.isFinite(c.lat) &&
          typeof c.lon === 'number' &&
          Number.isFinite(c.lon) &&
          typeof c.zoom === 'number' &&
          Number.isFinite(c.zoom)
        ) {
          return {
            lat: c.lat,
            lon: c.lon,
            zoom: c.zoom,
            bearing: typeof c.bearing === 'number' && Number.isFinite(c.bearing) ? c.bearing : 0,
          };
        }
      } catch {
        /* corrupt blob; fall through */
      }
      return fallback;
    },
  );
  // Persist camera state on every pan / zoom / rotation. moveend fires
  // for both user-driven and programmatic camera changes; that's fine —
  // any flyTo we issue (e.g. "fly to boat" button) is something the user
  // initiated and would want remembered.
  useEffect(() => {
    if (!mapInstance) return;
    // Map's prop interface only has center+zoom; bearing has to be set
    // imperatively after construction.
    if (initialCamera.bearing) mapInstance.setBearing(initialCamera.bearing);
    const handler = (): void => {
      const c = mapInstance.getCenter();
      try {
        window.localStorage.setItem(
          'chart:camera',
          JSON.stringify({
            lat: c.lat,
            lon: c.lng,
            zoom: mapInstance.getZoom(),
            bearing: mapInstance.getBearing(),
          }),
        );
      } catch {
        /* quota / private mode; ignore */
      }
    };
    mapInstance.on('moveend', handler);
    return () => {
      mapInstance.off('moveend', handler);
    };
  }, [mapInstance, initialCamera.bearing]);

  // Persist the user-tunable chart settings to localStorage so switching to
  // a different tab and back doesn't reset them. Two-effect dance: hydrate
  // on mount, then write on every change but only AFTER hydration finishes
  // (so we don't clobber the saved state with first-render defaults).
  const [settingsHydrated, setSettingsHydrated] = useState(false);
  useEffect(() => {
    try {
      const raw = localStorage.getItem('chart:settings');
      if (raw) {
        const j = JSON.parse(raw) as Partial<{
          windHours: number;
          windLockNow: boolean;
        }>;
        if (typeof j.windHours === 'number') setWindHours(j.windHours);
        if (typeof j.windLockNow === 'boolean') setWindLockNow(j.windLockNow);
      }
    } catch {
      /* corrupt blob; ignore */
    }
    setSettingsHydrated(true);
  }, []);
  useEffect(() => {
    if (!settingsHydrated) return;
    try {
      localStorage.setItem('chart:settings', JSON.stringify({ windHours, windLockNow }));
    } catch {
      /* quota / private-mode; ignore */
    }
  }, [settingsHydrated, windHours, windLockNow]);

  const [waypoints, setWaypoints] = useState<
    Array<{ id: string; name: string; lat: number; lon: number }>
  >([]);
  const [routes, setRoutes] = useState<Partial<Record<'GFS' | 'ECMWF', Route>>>({});
  const [showIsochrones, setShowIsochrones] = useState(false);
  const [showRouteWind, setShowRouteWind] = useState(false);
  const [playbackStates, setPlaybackStates] = useState<
    Partial<Record<'GFS' | 'ECMWF', PlaybackState>>
  >({});
  const ROUTE_COLOR: Record<'GFS' | 'ECMWF', string> = { GFS: '#f59e0b', ECMWF: '#22d3ee' };
  const ROUTE_LAYER: Record<'GFS' | 'ECMWF', string> = { GFS: 'route-gfs', ECMWF: 'route-ecmwf' };
  // Route line-colour mode (display only). Persisted; hydrated after mount.
  const [routeColorMode, setRouteColorMode] = useState<RouteColorMode>('none');
  useEffect(() => {
    const raw = window.localStorage.getItem('chart:routeColorMode');
    if (raw === 'none' || raw === 'tack' || raw === 'sog' || raw === 'twa') setRouteColorMode(raw);
  }, []);
  useEffect(() => {
    try {
      window.localStorage.setItem('chart:routeColorMode', routeColorMode);
    } catch {
      /* quota / private mode */
    }
  }, [routeColorMode]);
  const [error, setError] = useState<string | undefined>();

  // Saved-track overlays. /tracks writes which tracks to show (+ colour mode)
  // to the `chart:trackLayers` localStorage key; we read it on mount and re-read
  // when another tab changes it (the `storage` event only fires cross-document,
  // which is exactly the two-tab case — within one tab, navigating back to
  // /chart remounts this page and re-reads fresh). Visible tracks' points are
  // lazily fetched and cached so toggling doesn't re-hit the server.
  const [trackLayers, setTrackLayers] = useState<Record<string, TrackLayerPref>>({});
  const [trackCache, setTrackCache] = useState<Record<string, Track>>({});
  useEffect(() => {
    const read = (): void => {
      try {
        const raw = window.localStorage.getItem(TRACK_LAYERS_KEY);
        setTrackLayers(raw ? (JSON.parse(raw) as Record<string, TrackLayerPref>) : {});
      } catch {
        setTrackLayers({});
      }
    };
    read();
    const onStorage = (e: StorageEvent): void => {
      if (e.key === TRACK_LAYERS_KEY) read();
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);

  // Fetch + cache points for any newly-visible track.
  useEffect(() => {
    const wanted = Object.entries(trackLayers)
      .filter(([, v]) => v.visible)
      .map(([id]) => id);
    for (const id of wanted) {
      if (trackCache[id]) continue;
      void fetch(`/api/tracks/${id}`, { cache: 'no-store' })
        .then((r) => r.json())
        .then((j: { ok: boolean; track?: Track }) => {
          if (j.ok && j.track) setTrackCache((prev) => ({ ...prev, [id]: j.track! }));
        })
        .catch(() => {
          /* ignore — track may have been deleted */
        });
    }
  }, [trackLayers, trackCache]);

  // Draw the colour-coded route line for each model that has a route, and
  // remove the layer for any model that doesn't. GFS = amber, ECMWF = cyan.
  useEffect(() => {
    const map = mapInstance;
    if (!map) return;
    (['GFS', 'ECMWF'] as const).forEach((m) => {
      const r = routes[m];
      if (r) attachRoute(map, ROUTE_LAYER[m], r, ROUTE_COLOR[m], routeColorMode);
      else detachRoute(map, ROUTE_LAYER[m]);
    });
  }, [routes, mapInstance, routeColorMode]);

  // Any leg motoring? Disables TWA colouring (meaningless under engine) and
  // is what makes those segments draw dashed.
  const hasMotoring = (['GFS', 'ECMWF'] as const).some((m) =>
    routes[m]?.legs.some((l) => l.motoring),
  );
  useEffect(() => {
    if (routeColorMode === 'twa' && hasMotoring) setRouteColorMode('none');
  }, [routeColorMode, hasMotoring]);

  // Track the cursor position over the map so the bottom-left readout
  // can show "lat lon, distance + bearing from boat". Cleared on
  // mouseleave so the panel disappears when not pointing at the map.
  useEffect(() => {
    if (!mapInstance) return;
    const onMove = (e: maplibregl.MapMouseEvent): void => {
      setCursorLatLon({ lat: e.lngLat.lat, lon: e.lngLat.lng });
    };
    const onLeave = (): void => setCursorLatLon(null);
    mapInstance.on('mousemove', onMove);
    const canvas = mapInstance.getCanvas();
    canvas.addEventListener('mouseleave', onLeave);
    return () => {
      mapInstance.off('mousemove', onMove);
      canvas.removeEventListener('mouseleave', onLeave);
    };
  }, [mapInstance]);

  // Manifest sync — three triggers, in priority order:
  //   1. BroadcastChannel('forecast-cache') message from the /forecast tab
  //      when it completes a fetch. Same-origin, near-instant.
  //   2. tab focus (`visibilitychange` → visible) — covers the case where
  //      the /forecast tab is in a different browser/window.
  //   3. background poll every 30 s as a safety net.
  useEffect(() => {
    if (!mv.isWindModel) return;
    let alive = true;
    const tick = async (): Promise<void> => {
      try {
        const [mr, sr] = await Promise.all([
          fetch('/api/forecast/manifest', { cache: 'no-store' }),
          fetch('/api/settings', { cache: 'no-store' }),
        ]);
        const j = await mr.json();
        const sj = await sr.json();
        if (!alive || !j.ok) return;
        // Only count grids cached for the CURRENT ROI box, so moving the box
        // empties the timeline band and a fetch fills it. (Grids for the old
        // box stay cached, so an unfiltered count would always read full.)
        const roi = sj?.settings?.forecastBbox as
          | { latMin: number; latMax: number; lonMin: number; lonMax: number }
          | undefined;
        const near = (x: number, y: number): boolean => Math.abs(x - y) < 0.01;
        // Lift the ROI box for WindOverlay. Only replace the object when a
        // value actually changed, so its identity stays stable (avoids a
        // refresh-key bump — and overlay re-fetch — on every 30 s poll).
        setForecastBbox((prev) => {
          const next = roi ?? null;
          if (prev === next) return prev;
          if (
            prev &&
            next &&
            near(prev.latMin, next.latMin) &&
            near(prev.latMax, next.latMax) &&
            near(prev.lonMin, next.lonMin) &&
            near(prev.lonMax, next.lonMax)
          ) {
            return prev;
          }
          return next;
        });
        const matches = (b: typeof roi): boolean =>
          !roi ||
          (!!b &&
            near(b.latMin, roi.latMin) &&
            near(b.latMax, roi.latMax) &&
            near(b.lonMin, roi.lonMin) &&
            near(b.lonMax, roi.lonMax));
        const gfs = new Set<number>();
        const ecmwf = new Set<number>();
        const hrrr = new Set<number>();
        let gfsRun: number | null = null;
        let ecmwfRun: number | null = null;
        let hrrrRun: number | null = null;
        for (const e of j.entries as Array<{
          model: 'gfs' | 'ecmwf' | 'hrrr';
          forecastHour: number;
          runAt: number;
          bbox: { latMin: number; latMax: number; lonMin: number; lonMax: number };
        }>) {
          if (!matches(e.bbox)) continue;
          const bucket = e.model === 'gfs' ? gfs : e.model === 'hrrr' ? hrrr : ecmwf;
          bucket.add(e.forecastHour);
          if (e.model === 'gfs') gfsRun = Math.max(gfsRun ?? 0, e.runAt);
          else if (e.model === 'hrrr') hrrrRun = Math.max(hrrrRun ?? 0, e.runAt);
          else ecmwfRun = Math.max(ecmwfRun ?? 0, e.runAt);
        }
        setAvailableHours({
          gfs: [...gfs].sort((a, b) => a - b),
          ecmwf: [...ecmwf].sort((a, b) => a - b),
          hrrr: [...hrrr].sort((a, b) => a - b),
        });
        setLatestRunAt({ gfs: gfsRun, ecmwf: ecmwfRun, hrrr: hrrrRun });
      } catch {
        /* ignore */
      }
    };
    void tick();

    const bc =
      typeof BroadcastChannel !== 'undefined' ? new BroadcastChannel('forecast-cache') : null;
    bc?.addEventListener('message', () => void tick());

    const onVisible = (): void => {
      if (document.visibilityState === 'visible') void tick();
    };
    document.addEventListener('visibilitychange', onVisible);

    const id = setInterval(() => void tick(), 30_000);
    return () => {
      alive = false;
      clearInterval(id);
      bc?.close();
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [layers.model, mv.isWindModel]);

  // When the model, selected hour, or available cache changes, bump refreshKey
  // so the overlay re-reads its grid. NOT gated on a live fix and NOT keyed on
  // position: the overlay looks grids up by (model, hour) regardless of boat
  // location, so it must refresh even before/without a GPS fix (e.g. on the
  // Mac, or in port) — otherwise it stays stuck on its stale mount-time fetch
  // while the cache fills behind it.
  useEffect(() => {
    setWindRefreshKey((k) => k + 1);
  }, [layers.model, windHours, availableHours, forecastBbox]);

  // A CMEMS refresh from the /forecast tab broadcasts on 'current-cache';
  // re-read the cached current grid so an already-open chart picks it up.
  useEffect(() => {
    if (typeof BroadcastChannel === 'undefined') return;
    const bc = new BroadcastChannel('current-cache');
    bc.addEventListener('message', () => setCurrentRefreshKey((k) => k + 1));
    return () => bc.close();
  }, []);

  // Load saved waypoints once so they're selectable as Start / End.
  useEffect(() => {
    void fetch('/api/waypoints')
      .then((r) => r.json())
      .then((j) => {
        if (j.ok) setWaypoints(j.waypoints);
      })
      .catch(() => {
        /* ignore */
      });
  }, []);

  // Restore the in-progress route from localStorage so navigating to /helm
  // and back doesn't wipe a freshly-planned route. Intentionally does NOT
  // restore start/end — the user wants those auto-preselected to the live
  // boat position and the active passage destination on every visit (their words: "preselect
  // ... whenever I come to the chart page"). The route polyline still
  // renders against the actual lat/lons it was planned with, so a stale
  // route stays accurate even if the boat has moved since.
  const [restored, setRestored] = useState(false);
  useEffect(() => {
    try {
      const raw = localStorage.getItem('chart:planState');
      if (raw) {
        const saved = JSON.parse(raw) as { routes?: Partial<Record<'GFS' | 'ECMWF', Route>> };
        setRoutes(saved.routes ?? {});
      }
    } catch {
      /* corrupt or quota — drop it on the floor */
    }
    setRestored(true);
  }, []);

  const [waypointDropActive, setWaypointDropActive] = useState(false);
  const [selectedWaypointId, setSelectedWaypointId] = useState<string | null>(null);
  // Route Start/End waypoint ids (owned here so the marks can be badged
  // green/red on the chart).
  const [routeStartId, setRouteStartId] = useState('');
  const [routeEndId, setRouteEndId] = useState('');

  // Crosshair cursor while waypoint-drop mode is active.
  useEffect(() => {
    if (!mapInstance) return;
    const canvas = mapInstance.getCanvas();
    canvas.style.cursor = waypointDropActive ? 'crosshair' : '';
    return () => {
      canvas.style.cursor = '';
    };
  }, [mapInstance, waypointDropActive]);

  // Esc cancels waypoint-drop mode.
  useEffect(() => {
    if (!waypointDropActive) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setWaypointDropActive(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [waypointDropActive]);

  // Clear any open waypoint-edit popup when entering drop-mode so the two
  // interaction modes don't overlap.
  useEffect(() => {
    if (waypointDropActive) setSelectedWaypointId(null);
  }, [waypointDropActive]);

  // Auto-names via nextWaypointName, POSTs to /api/waypoints, and adds the pin
  // to state immediately. Shared by drop-mode clicks and the long-press gesture.
  const dropWaypointAt = async ({ lat, lon }: { lat: number; lon: number }) => {
    const name = nextWaypointName(waypoints.map((w) => w.name));
    try {
      const res = await fetch('/api/waypoints', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name, lat, lon }),
      });
      const j = (await res.json()) as {
        ok: boolean;
        waypoint?: {
          id: string;
          name: string;
          lat: number;
          lon: number;
          notes?: string;
          createdAt?: string;
        };
      };
      if (res.ok && j.ok && j.waypoint) {
        const wp = j.waypoint;
        setWaypoints((prev) => [...prev, { id: wp.id, name: wp.name, lat: wp.lat, lon: wp.lon }]);
      } else {
        setError('waypoint drop failed');
      }
    } catch {
      setError('waypoint drop failed');
    }
  };

  // Map-click handler for waypoint-drop mode: drop, then exit the mode.
  const handleDropClick = async ({ lat, lon }: { lat: number; lon: number }) => {
    setWaypointDropActive(false); // one waypoint per activation
    await dropWaypointAt({ lat, lon });
  };

  // Drag-to-move: optimistically update the mark, then persist the new
  // position. On failure, surface an error (the in-flight mark already moved
  // locally; a reload reflects the server's value).
  const handleMoveWaypoint = (id: string, lat: number, lon: number): void => {
    setWaypoints((prev) => prev.map((w) => (w.id === id ? { ...w, lat, lon } : w)));
    void fetch(`/api/waypoints/${id}`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ lat, lon }),
    })
      .then((r) => {
        if (!r.ok) setError('waypoint move failed');
      })
      .catch(() => setError('waypoint move failed'));
  };

  // Persist the routes. Start/end are deliberately omitted — see comment on
  // the restore effect above.
  useEffect(() => {
    if (!restored) return;
    try {
      localStorage.setItem('chart:planState', JSON.stringify({ routes }));
    } catch {
      /* quota or disabled — silently drop */
    }
  }, [routes, restored]);

  // Fresh plan from the panel: store the routes-by-model, draw them, and frame
  // them (exiting follow first so it doesn't immediately recenter on the boat).
  const handleRouted = (next: Partial<Record<'GFS' | 'ECMWF', Route>>): void => {
    setRoutes(next);
    const map = mapInstance;
    if (!map) return;
    if (camera.follow) camera.toggleFollow();
    const pts: Array<{ lat: number; lon: number }> = [];
    for (const r of Object.values(next))
      if (r) for (const l of r.legs) pts.push({ lat: l.lat, lon: l.lon });
    if (pts.length >= 2) {
      let latMin = Infinity,
        latMax = -Infinity,
        lonMin = Infinity,
        lonMax = -Infinity;
      for (const p of pts) {
        latMin = Math.min(latMin, p.lat);
        latMax = Math.max(latMax, p.lat);
        lonMin = Math.min(lonMin, p.lon);
        lonMax = Math.max(lonMax, p.lon);
      }
      try {
        map.fitBounds(
          [
            [lonMin, latMin],
            [lonMax, latMax],
          ],
          { padding: 60, duration: 800 },
        );
      } catch {
        /* style not ready */
      }
    }
  };

  const handleClearRoute = (): void => {
    setRoutes({});
    if (mapInstance)
      (['GFS', 'ECMWF'] as const).forEach((m) => detachRoute(mapInstance, ROUTE_LAYER[m]));
  };

  // Drive the wind overlay's selected forecast hour from the playback clock.
  // The scrubber reports a wall-clock time `t`; map it to the nearest cached
  // forecast hour for the active wind model and unlock the slider so the
  // overlay tracks the ghost boats as they advance.
  const onWindHour = (t: number): void => {
    const model: 'gfs' | 'ecmwf' | 'hrrr' = mv.windModel ?? 'gfs';
    const run = latestRunAt[model];
    if (run == null) return;
    const h = nearestForecastHour(run, t, availableHours[model]);
    if (h != null) {
      setWindLockNow(false);
      setWindHours(h);
    }
  };

  // OSM basemap visibility. The layer is mounted unconditionally inside
  // Map.tsx's initial style; we just flip its `visibility` layout property.
  // When OSM is hidden the `__bg-black__` background layer underneath shows
  // through, giving true black instead of MapLibre default grey.
  useEffect(() => {
    const map = mapInstance;
    if (!map) return;
    const apply = (): void => {
      if (!map.getLayer('osm')) return;
      map.setLayoutProperty('osm', 'visibility', layers.osm ? 'visible' : 'none');
    };
    apply();
    map.on('styledata', apply);
    return () => {
      map.off('styledata', apply);
    };
  }, [mapInstance, layers.osm]);

  // Load a saved plan via the ?plan=<id> URL param so /plans → click name
  // takes you to the chart with that route already overlaid. Runs once
  // when the param is present.
  const searchParams = useSearchParams();
  const planIdFromUrl = searchParams.get('plan');
  const loadedPlanRef = useRef<string | null>(null);
  useEffect(() => {
    if (!planIdFromUrl || loadedPlanRef.current === planIdFromUrl) return;
    loadedPlanRef.current = planIdFromUrl;
    void (async () => {
      try {
        const r = await fetch(`/api/plans/${planIdFromUrl}`, { cache: 'no-store' });
        const j = (await r.json()) as
          | { ok: true; plan: { route: Route } }
          | { ok: false; error?: { message?: string } };
        if (!j.ok) {
          setError(j.error?.message ?? 'plan not found');
          return;
        }
        setRoutes({ GFS: j.plan.route });
      } catch (e) {
        setError(String(e));
      }
    })();
  }, [planIdFromUrl]);

  return (
    <main className="grid grid-cols-[1fr_360px] flex-1 min-h-0 [&>div:first-child]:relative">
      <div className="relative">
        <Map
          center={{ lat: initialCamera.lat, lon: initialCamera.lon }}
          zoom={initialCamera.zoom}
          onLoad={(m) => {
            mapRef.current = m;
            setMapInstance(m);
          }}
          onClick={waypointDropActive ? handleDropClick : undefined}
          onLongPress={dropWaypointAt}
          suppressLongPressLayers={['waypoints-dot']}
        />
        {showIsochrones && <IsochroneLayer map={mapInstance} routes={routes} />}
        {showRouteWind && <RouteWindLayer map={mapInstance} routes={routes} />}
        <LiveBoatMarker map={mapInstance} onUpdate={setLivePos} flyToOnFirstFix={false} />
        <CogExtension
          map={mapInstance}
          p={livePos}
          // Own-boat extension is distance-based (100 NM ahead),
          // regardless of SOG. AIS targets keep the time-based 6 h
          // horizon below so "where will everyone be in 6 h" still
          // reads as a single comparable forecast.
          totalNm={100}
          hidden={false}
        />
        {layers.ais && (
          <AisTargets
            map={mapInstance}
            cogExtensionMinutes={COG_EXTENSION_MINUTES}
            showCogExtensions={layers.aisCog}
            own={livePos}
          />
        )}
        <ForecastRoi
          map={mapInstance}
          defaultBbox={
            livePos
              ? {
                  latMin: livePos.lat - 2,
                  latMax: livePos.lat + 2,
                  lonMin: livePos.lon - 2,
                  lonMax: livePos.lon + 2,
                }
              : undefined
          }
          activeWindModel={mv.windModel}
        />
        <WaypointsLayer
          map={mapInstance}
          marks={waypoints.map((w) => ({
            id: w.id,
            lat: w.lat,
            lon: w.lon,
            name: w.name,
            badge:
              w.id === routeStartId
                ? ('S' as const)
                : w.id === routeEndId
                  ? ('E' as const)
                  : undefined,
          }))}
          onSelectWaypoint={waypointDropActive ? undefined : (id) => setSelectedWaypointId(id)}
          onMoveWaypoint={waypointDropActive ? undefined : handleMoveWaypoint}
        />
        {Object.entries(trackLayers)
          .filter(([id, v]) => v.visible && trackCache[id])
          // Skip the active (still-recording) track — LiveBoatMarker already
          // draws it as the green live trail, so an overlay would double it.
          .filter(([id]) => trackCache[id]!.endedAt !== null)
          .map(([id, v]) => (
            <TrackOverlay
              key={id}
              map={mapInstance}
              id={`track-overlay-${id}`}
              points={trackCache[id]!.points}
              colorMode={v.colorMode}
            />
          ))}
        <WindOverlay
          map={mapInstance}
          centerLat={livePos?.lat ?? null}
          centerLon={livePos?.lon ?? null}
          model={mv.windModel ?? 'gfs'}
          hours={windHours}
          hidden={mv.windHidden}
          opacity={0.5}
          showFill={true}
          showBarbs={true}
          showIsobars={true}
          refreshKey={windRefreshKey}
          bbox={forecastBbox}
          onLoaded={({ grid, identical, error }) => {
            if (error) {
              setWindGrid(null); // clear the "Showing: <model>" line + cursor readout
              setWindStatus(`Not cached: ${error}`);
            } else if (grid) {
              setWindGrid(grid);
              if (identical) setWindStatus(null);
            }
            if (windStatus) setTimeout(() => setWindStatus(null), 4000);
          }}
        />
        <CurrentOverlay
          map={mapInstance}
          hidden={mv.currentHidden}
          day={0}
          opacity={0.85}
          refreshKey={currentRefreshKey}
          onLoaded={({ grid, error }) => {
            if (error === 'not cached') {
              setCurrentGrid(null);
              setCurrentStatus('No CMEMS grid cached — refresh from the Forecast page.');
            } else if (error) {
              setCurrentGrid(null);
              setCurrentStatus(`Error: ${error}`);
            } else if (grid) {
              setCurrentGrid(grid);
              setCurrentStatus(
                `CMEMS daily mean for ${new Date(grid.validAt * 1000).toISOString().slice(0, 10)}`,
              );
            }
          }}
        />
        {/* <LaylinesLayer map={mapInstance} />  disabled — not currently useful */}
        <StartLineLayer map={mapInstance} />
        <EncLayer map={mapInstance} visible={layers.enc} />
        <SatelliteLayer map={mapInstance} visible={layers.satellite} />
        <EncBuoyLayer map={mapInstance} visible={layers.buoys} />
        <BathyLayer map={mapInstance} visible={layers.bathy} />
        {(() => {
          const sel = selectedWaypointId
            ? waypoints.find((w) => w.id === selectedWaypointId)
            : null;
          if (!sel) return null;
          return (
            <WaypointEditPopup
              map={mapInstance}
              waypoint={{ id: sel.id, name: sel.name, lat: sel.lat, lon: sel.lon }}
              onSaved={(updated) => {
                setWaypoints((prev) =>
                  prev.map((w) =>
                    w.id === updated.id
                      ? { id: updated.id, name: updated.name, lat: updated.lat, lon: updated.lon }
                      : w,
                  ),
                );
                setSelectedWaypointId(null); // dismiss the popup after a save
              }}
              onDeleted={(id) => {
                setWaypoints((prev) => prev.filter((w) => w.id !== id));
                setSelectedWaypointId(null);
              }}
              onClose={() => setSelectedWaypointId(null)}
            />
          );
        })()}
        <ChartToolbar
          layers={layers}
          onToggleLayer={(key) => setLayers((prev) => ({ ...prev, [key]: !prev[key] }))}
          onSelectModel={(model) => setLayers((prev) => ({ ...prev, model }))}
          waypointDropActive={waypointDropActive}
          onToggleWaypointDrop={() => setWaypointDropActive((v) => !v)}
        />
        <MapLoadingIndicator map={mapInstance} />
        <ChartFollowControl
          follow={camera.follow}
          orientation={camera.orientation}
          hasFix={livePos !== null}
          onToggleFollow={camera.toggleFollow}
          onCycleOrientation={camera.cycleOrientation}
        />
        <OffscreenVesselIndicator
          map={mapInstance}
          livePos={livePos}
          visible={!camera.follow}
          onTap={camera.enterFollow}
        />
        <CursorReadout
          cursor={cursorLatLon}
          boat={livePos}
          variable={
            mv.isWindModel && windGrid
              ? { kind: 'wind', grid: windGrid }
              : mv.isCurrent && currentGrid
                ? { kind: 'current', grid: currentGrid }
                : null
          }
        />
        <TileLoadingIndicator map={mapInstance} />
      </div>
      <aside className="p-4 border-l border-slate-800 space-y-4 overflow-y-auto">
        <div className="flex items-center justify-between">
          <StatusBadge />
          <TzToggle tz={tz} setTz={setTz} />
        </div>
        <LiveValues p={livePos} />
        <RoutePlanPanel
          waypoints={waypoints}
          tz={tz}
          hasRoute={Object.keys(routes).length > 0}
          startId={routeStartId}
          endId={routeEndId}
          onStartId={setRouteStartId}
          onEndId={setRouteEndId}
          colorMode={routeColorMode}
          onColorMode={setRouteColorMode}
          colorTwaDisabled={hasMotoring}
          onRouted={handleRouted}
          onClear={handleClearRoute}
          showIsochrones={showIsochrones}
          onShowIsochrones={setShowIsochrones}
          showRouteWind={showRouteWind}
          onShowRouteWind={setShowRouteWind}
        />
        {Object.keys(routes).length > 0 && (
          <>
            <PlaybackScrubber
              map={mapInstance}
              routes={routes}
              tz={tz}
              onStates={setPlaybackStates}
              onWindHour={onWindHour}
            />
            {(['GFS', 'ECMWF'] as const)
              .filter((m) => routes[m])
              .map((m) => (
                <RouteDetailsBox
                  key={m}
                  model={m}
                  color={ROUTE_COLOR[m]}
                  state={playbackStates[m] ?? null}
                />
              ))}
          </>
        )}
        <div className="space-y-2 bg-slate-900/60 border border-slate-800 rounded p-2">
          {mv.isCurrent && (
            <div className="text-xs space-y-1 pt-1 border-t border-slate-800 mt-1">
              <p className="text-slate-400">
                Surface currents from Copernicus Marine (CMEMS) daily-mean global analysis (1/12°,
                surface depth). Colour = speed in knots; arrows = direction. Refreshed
                automatically; trigger a manual pull from the Forecast page.
              </p>
              {currentStatus && <p className="text-slate-400">{currentStatus}</p>}
            </div>
          )}
          {/* Wind-forecast timeline (run, valid time, hour stepper). Only
              shown when a wind model (GFS/ECMWF) is active — CMEMS is a
              daily mean without an hour-stepped slider. */}
          {mv.isWindModel &&
            (() => {
              const fullList = availableHours[mv.windModel ?? 'gfs'];
              const activeWindModel = mv.windModel ?? 'gfs';
              if (fullList.length === 0) {
                return (
                  <div className="text-xs text-amber-300">
                    No {activeWindModel.toUpperCase()} forecast cached. Visit{' '}
                    <a href="/forecast" className="underline">
                      Forecast
                    </a>
                    .
                  </div>
                );
              }
              // Filter out forecast hours whose valid time is in the past.
              // Slider always starts at "now" (or the first cached hour
              // that's still useful). Falls back to the full list if we
              // don't yet know the run time.
              const runAt = latestRunAt[activeWindModel];
              const nowS = Date.now() / 1000;
              const list = runAt
                ? fullList.filter((h) => runAt + h * 3600 >= nowS - 1800) // 30 min grace
                : fullList;
              if (list.length === 0) {
                return (
                  <div className="text-xs text-amber-300">
                    {activeWindModel.toUpperCase()} forecast cache is stale (all valid times in the
                    past). Refresh on{' '}
                    <a href="/forecast" className="underline">
                      Forecast
                    </a>
                    .
                  </div>
                );
              }
              // The hour whose valid time is closest to now (used when locked).
              // With runAt unknown, list[0] is the earliest still-valid hour.
              const nearestNowIdx = (): number => {
                if (!runAt) return 0;
                let best = 0;
                let bestDiff = Infinity;
                for (let i = 0; i < list.length; i++) {
                  const d = Math.abs(runAt + list[i]! * 3600 - nowS);
                  if (d < bestDiff) {
                    bestDiff = d;
                    best = i;
                  }
                }
                return best;
              };
              const idx = list.indexOf(windHours);
              // Locked → track the nearest-now hour (advances as the clock moves
              // and fresh hours land); unlocked → keep the user's chosen hour.
              const effectiveIdx = windLockNow ? nearestNowIdx() : idx >= 0 ? idx : 0;
              const effectiveHours = list[effectiveIdx]!;
              if (effectiveHours !== windHours) {
                setTimeout(() => setWindHours(effectiveHours), 0);
              }
              // ←/→ are explicit hour navigation, so they exit lock mode.
              const goPrev = (): void => {
                if (effectiveIdx > 0) {
                  setWindLockNow(false);
                  setWindHours(list[effectiveIdx - 1]!);
                }
              };
              const goNext = (): void => {
                if (effectiveIdx < list.length - 1) {
                  setWindLockNow(false);
                  setWindHours(list[effectiveIdx + 1]!);
                }
              };
              // Label: "HH:MM[Z] DD MMM (in N h)" — absolute time in the
              // page's current Local/UTC mode, plus a relative offset so
              // it's clear where we are on the timeline.
              let label = `+${effectiveHours}h`;
              if (runAt) {
                const validUnix = runAt + effectiveHours * 3600;
                const absLabel = fmtHourLabel(validUnix, tz);
                const hoursFromNow = (validUnix - nowS) / 3600;
                const rel =
                  Math.abs(hoursFromNow) < 0.5
                    ? 'now'
                    : hoursFromNow < 0
                      ? `${Math.round(-hoursFromNow)}h ago`
                      : `in ${Math.round(hoursFromNow)}h`;
                label = `${absLabel} (${rel})`;
              }
              return (
                <div className="space-y-1">
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => setWindLockNow((v) => !v)}
                      aria-pressed={windLockNow}
                      className={`px-2 py-0.5 text-xs rounded ${
                        windLockNow
                          ? 'bg-sky-600 text-white'
                          : 'bg-slate-700 text-slate-300 hover:bg-slate-600'
                      }`}
                      title={
                        windLockNow
                          ? 'Locked to current time — click to unlock and scrub'
                          : 'Lock the slider to current time'
                      }
                    >
                      now
                    </button>
                    <button
                      type="button"
                      onClick={goPrev}
                      disabled={effectiveIdx <= 0}
                      className="px-2 py-0.5 text-xs bg-slate-700 hover:bg-slate-600 rounded disabled:opacity-30"
                      title="Previous cached hour"
                    >
                      ←
                    </button>
                    <span className="text-xs text-slate-400 font-mono flex-1 text-center">
                      {label}
                    </span>
                    <button
                      type="button"
                      onClick={goNext}
                      disabled={effectiveIdx >= list.length - 1}
                      className="px-2 py-0.5 text-xs bg-slate-700 hover:bg-slate-600 rounded disabled:opacity-30"
                      title="Next cached hour"
                    >
                      →
                    </button>
                  </div>
                  {(() => {
                    // Slider spans the full intended range (to +168 h, past
                    // hours dropped) so a two-band track can show how far the
                    // cache has filled: darker = available (cached), lighter =
                    // still in progress. The thumb still snaps to cached hours.
                    const minH = list[0]!;
                    const availMaxH = list[list.length - 1]!;
                    // HRRR is short-horizon (≤18 h, or ≤48 h on synoptic runs),
                    // far shorter than GFS/ECMWF's 168 h — clamp the intended
                    // range so the slider doesn't render a long empty band.
                    const intendedHours =
                      activeWindModel === 'hrrr'
                        ? WIND_FORECAST_HOURS.filter(
                            (h) => h <= hrrrHorizonHours(pickHrrrRun(nowS).runHourUtc),
                          )
                        : WIND_FORECAST_HOURS;
                    const expectedMaxH = Math.max(
                      availMaxH,
                      ...intendedHours.filter((h) => !runAt || runAt + h * 3600 >= nowS - 1800),
                    );
                    const span = expectedMaxH - minH;
                    const availPct = span > 0 ? ((availMaxH - minH) / span) * 100 : 100;
                    return (
                      <div className="relative w-full">
                        {/* Two-band track behind the slider: lighter = still
                            in progress, darker = available (cached). */}
                        <div className="absolute inset-x-0 top-1/2 -translate-y-1/2 h-1.5 rounded-full overflow-hidden bg-sky-300/40">
                          <div
                            className="absolute inset-y-0 left-0 bg-sky-600"
                            style={{ width: `${availPct}%` }}
                            title="Available (cached); the lighter band is still being fetched"
                          />
                        </div>
                        <input
                          type="range"
                          min={minH}
                          max={expectedMaxH}
                          step={1}
                          value={effectiveHours}
                          onChange={(e) => {
                            const v = Number(e.target.value);
                            const nearest = list.reduce(
                              (best, h) => (Math.abs(h - v) < Math.abs(best - v) ? h : best),
                              list[0]!,
                            );
                            setWindLockNow(false); // scrubbing exits lock mode
                            setWindHours(nearest);
                          }}
                          className="fc-slider relative block w-full"
                        />
                      </div>
                    );
                  })()}
                </div>
              );
            })()}
          {mv.isWindModel && windGrid && (
            <div className="text-xs text-slate-400 leading-tight">
              <div>
                Showing:{' '}
                <span className="text-slate-200 font-mono">{windGrid.model.toUpperCase()}</span>
              </div>
              <div>
                Run:{' '}
                <span className="text-slate-200 font-mono">{fmtHourLabel(windGrid.runAt, tz)}</span>
              </div>
              <div>
                Valid:{' '}
                <span className="text-slate-200 font-mono">
                  {fmtHourLabel(windGrid.validAt, tz)}
                </span>{' '}
                (+{windGrid.forecastHour}h)
              </div>
            </div>
          )}
          {layers.model === 'hrrr' && forecastBbox && !inHrrrDomain(forecastBbox) && (
            <div className="text-xs text-amber-300">
              HRRR covers US waters only — no data for this area. Move the forecast region inside
              the continental US, or pick GFS/ECMWF for offshore.
            </div>
          )}
          {mv.isWindModel && windStatus && (
            <div className="text-xs text-emerald-300">{windStatus}</div>
          )}
          {mv.isWindModel && forecastBbox && mapInstance && (
            <button
              type="button"
              onClick={() => {
                try {
                  mapInstance.fitBounds(
                    [
                      [forecastBbox.lonMin, forecastBbox.latMin],
                      [forecastBbox.lonMax, forecastBbox.latMax],
                    ],
                    { padding: 40, duration: 600 },
                  );
                } catch {
                  /* style not ready */
                }
              }}
              className="w-full px-2 py-1 text-xs bg-slate-700 hover:bg-slate-600 rounded"
              title="Zoom to the forecast region to see and drag the corner handles"
            >
              Fit to forecast region
            </button>
          )}
          {mv.isWindModel && <WindLegend />}
        </div>
        {error && <div className="text-rose-400 text-xs">{error}</div>}
      </aside>
    </main>
  );
}

function LiveValues({ p }: { p: LivePos | null }) {
  if (!p) {
    return <div className="text-xs text-slate-500">Waiting for live fix…</div>;
  }
  const MS_TO_KN = 1 / 0.514444;
  const RAD_TO_DEG = 180 / Math.PI;
  // Compact marine DMM matching the shared format-coords helper:
  // `33 42.232n` (no °/′ symbols, lowercase hemisphere).
  const fmtCoord = (deg: number, axis: 'lat' | 'lon'): string => {
    const hemi = deg >= 0 ? (axis === 'lat' ? 'n' : 'e') : axis === 'lat' ? 's' : 'w';
    const abs = Math.abs(deg);
    const d = Math.floor(abs);
    const m = (abs - d) * 60;
    return `${d} ${m.toFixed(3)}${hemi}`;
  };
  const wrap360 = (deg: number): number => ((deg % 360) + 360) % 360;
  const cogDeg = typeof p.cog === 'number' ? wrap360(p.cog * RAD_TO_DEG) : null;
  const hdgDeg = typeof p.hdg === 'number' ? wrap360(p.hdg * RAD_TO_DEG) : null;
  const sogKn = typeof p.sog === 'number' ? p.sog * MS_TO_KN : null;
  return (
    <div className="text-xs space-y-0.5 bg-slate-900/60 border border-slate-800 rounded p-2">
      <div className="font-mono text-slate-200">{fmtCoord(p.lat, 'lat')}</div>
      <div className="font-mono text-slate-200">{fmtCoord(p.lon, 'lon')}</div>
      <div className="text-slate-400">
        SOG:{' '}
        <span className="text-slate-200 font-mono">
          {sogKn !== null ? `${sogKn.toFixed(1)} kn` : '—'}
        </span>
      </div>
      <div className="text-slate-400">
        COG:{' '}
        <span className="text-slate-200 font-mono">
          {cogDeg !== null ? `${cogDeg.toFixed(0)}° T` : '—'}
        </span>
      </div>
      <div className="text-slate-400">
        HDG:{' '}
        <span className="text-slate-200 font-mono">
          {hdgDeg !== null ? `${hdgDeg.toFixed(0)}° T` : '—'}
        </span>
      </div>
    </div>
  );
}

/**
 * Bottom-left chart overlay showing the lat/lon under the mouse plus
 * distance and bearing from the live boat fix. Renders nothing when the
 * cursor isn't over the map.
 */
function CursorReadout({
  cursor,
  boat,
  variable,
}: {
  cursor: { lat: number; lon: number } | null;
  boat: LivePos | null;
  variable: { kind: 'wind' | 'current'; grid: UvGrid } | null;
}) {
  if (!cursor) return null;
  const hasBoat = !!boat && Number.isFinite(boat.lat) && Number.isFinite(boat.lon);
  const rangeBearing = hasBoat
    ? haversineAndBearing({ lat: boat!.lat, lon: boat!.lon }, cursor)
    : null;
  // The displayed model variable (wind / current) interpolated at the cursor.
  // Absolute compass direction from the grid's u/v — nothing to do with the boat.
  const varLine = ((): string | null => {
    if (!variable) return null;
    const uv = sampleUV(variable.grid, cursor.lat, cursor.lon);
    if (!uv) return null; // cursor outside the grid's coverage
    const MS_TO_KN = 1 / 0.514444;
    const speedKn = Math.hypot(uv.u, uv.v) * MS_TO_KN;
    if (variable.kind === 'wind') {
      // Wind FROM: the direction it blows out of (atan2 of the reversed vector).
      const fromDeg = (Math.atan2(-uv.u, -uv.v) * 180) / Math.PI;
      const d = ((fromDeg % 360) + 360) % 360;
      return `Wind ${speedKn.toFixed(1)} kn · ${cardinal16(d)} (${d.toFixed(0).padStart(3, '0')}°)`;
    }
    // Current SET: the direction it flows toward.
    const setDeg = (Math.atan2(uv.u, uv.v) * 180) / Math.PI;
    const d = ((setDeg % 360) + 360) % 360;
    return `Current ${speedKn.toFixed(1)} kn · set ${cardinal16(d)} (${d.toFixed(0).padStart(3, '0')}°)`;
  })();
  return (
    <div className="fixed bottom-3 right-3 z-30 px-3 py-2 bg-slate-900/85 border border-slate-700 text-slate-200 text-xs font-mono rounded shadow pointer-events-none leading-tight">
      <div>{fmtLatLonDmm(cursor.lat, cursor.lon)}</div>
      {varLine && <div className="text-sky-200 mt-1">{varLine}</div>}
      <div className="text-slate-300 mt-1">
        {rangeBearing
          ? `${rangeBearing.distNm.toFixed(1)} NM · ${rangeBearing.bearingDeg
              .toFixed(0)
              .padStart(3, '0')}° from boat`
          : '— · — (boat fix pending)'}
      </div>
    </div>
  );
}

/** 16-point compass abbreviation for a true bearing in degrees. */
function cardinal16(deg: number): string {
  const pts = [
    'N',
    'NNE',
    'NE',
    'ENE',
    'E',
    'ESE',
    'SE',
    'SSE',
    'S',
    'SSW',
    'SW',
    'WSW',
    'W',
    'WNW',
    'NW',
    'NNW',
  ];
  return pts[Math.round(deg / 22.5) % 16]!;
}

/** Great-circle distance (NM) and initial bearing (deg, 0-360, true). */
function haversineAndBearing(
  a: { lat: number; lon: number },
  b: { lat: number; lon: number },
): { distNm: number; bearingDeg: number } {
  const R_NM = 3440.065;
  const DEG = Math.PI / 180;
  const phi1 = a.lat * DEG;
  const phi2 = b.lat * DEG;
  const dphi = (b.lat - a.lat) * DEG;
  const dlam = (b.lon - a.lon) * DEG;
  const h = Math.sin(dphi / 2) ** 2 + Math.cos(phi1) * Math.cos(phi2) * Math.sin(dlam / 2) ** 2;
  const distNm = 2 * R_NM * Math.asin(Math.min(1, Math.sqrt(h)));
  const y = Math.sin(dlam) * Math.cos(phi2);
  const x = Math.cos(phi1) * Math.sin(phi2) - Math.sin(phi1) * Math.cos(phi2) * Math.cos(dlam);
  let bearingDeg = (Math.atan2(y, x) * 180) / Math.PI;
  if (bearingDeg < 0) bearingDeg += 360;
  return { distNm, bearingDeg };
}
