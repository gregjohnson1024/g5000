'use client';
import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import maplibregl from 'maplibre-gl';
import { Map } from '../../components/Map';
import { attachRoute, detachRoute, type RouteColorMode } from '../../components/RoutePolyline';
import { attachRouteConnector } from '../../components/RouteConnector';
import { LiveBoatMarker, type LivePos } from '../../components/LiveBoatMarker';
import { AisTargets } from '../../components/AisTargets';
import { StationsOverlay } from '../../components/StationsOverlay';
import { ForecastRoi } from '../../components/ForecastRoi';
import { WaypointsLayer } from '../../components/WaypointsLayer';
import { TrackOverlay, type TrackColorMode } from '../../components/TrackOverlay';
import { IsochroneLayer } from '../../components/IsochroneLayer';
import { RouteWindLayer } from '../../components/RouteWindLayer';
import { WaypointEditPopup } from '../../components/WaypointEditPopup';
import { fmtLatLonDmm } from '../../lib/coords';
import { cssColor } from '../../lib/map-colors';
import { greatCircleNm, bearingDeg } from '../../lib/geo';
import { MS_TO_KN, cardinal16 } from '../../lib/units';
// DriftArrow removed at user's request; computation kept on /helm via the
// shared @g5000/compute helper. If the chart needs set+drift back, prefer
// pulling it from /api/position rather than re-deriving here.
import { WindOverlay, type WindGrid } from '../../components/WindOverlay';
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
import { RadarOverlay } from '../../components/RadarOverlay';
import { MobButton } from '../../components/MobButton';
import { MobLayer } from '../../components/MobLayer';
import { AnchorWatchLayer } from '../../components/AnchorWatchLayer';
import { type LayersState, type LayerToggleKey } from './LayersControl';
import { type PresetName, CHART_PRESETS, applyPresetPatch, resetLayers } from './presets';
import { modelLayerView, type ChartModel } from './model-layer';
import { LayerDock } from './LayerDock';
import { ChartFollowControl } from './ChartFollowControl';
import { useRoutePlan } from './use-route-plan';
import { startOf, endOf } from '../../lib/route-plan';
import { ChartContextMenu } from './ChartContextMenu';
import { resolveTarget, type ContextTarget, type HitWaypoint } from '../../lib/route-hit-test';
import { OffscreenVesselIndicator } from './OffscreenVesselIndicator';
import { useChartCamera } from './use-chart-camera';
import { nextWaypointName } from './waypoint-name';
import { useShipClock } from '../../lib/use-ship-clock';
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
  // Shallow-contour highlight threshold for the bathy layer (m). 0 = off.
  const [safetyDepthM, setSafetyDepthM] = useState(0);
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
  // Feature gate for the CHS tide/current-station overlays (Canada-only data).
  // Synced from /api/settings by the ROI effect below; default hidden.
  const [canadianTideCurrents, setCanadianTideCurrents] = useState(false);
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
  // App-wide ship clock (boat-synced UTC ↔ ship-time setting; replaces the
  // old per-page Local/UTC toggle and its chart:tz localStorage key).
  const clock = useShipClock();
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
    tideStations: false,
    currentStations: false,
    radar: false,
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
          tideStations: parsed.tideStations ?? false,
          currentStations: parsed.currentStations ?? false,
          radar: parsed.radar ?? false,
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

  // Derive the active preset pill from the current layers: a named preset is
  // "active" when every key it patches already matches the current state.
  // 'custom' means the user has diverged from all named presets.
  const activePreset: PresetName = useMemo(() => {
    for (const name of Object.keys(CHART_PRESETS) as Array<Exclude<PresetName, 'custom'>>) {
      const patch = CHART_PRESETS[name];
      const matches = (Object.keys(patch) as Array<keyof LayersState>).every(
        (k) => layers[k] === patch[k],
      );
      if (matches) return name;
    }
    return 'custom';
  }, [layers]);

  const handleApplyPreset = useCallback((name: Exclude<PresetName, 'custom'>): void => {
    setLayers((prev) => applyPresetPatch(prev, name));
  }, []);

  const handleResetToDefault = useCallback((): void => {
    setLayers(resetLayers());
  }, []);

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
          safetyDepthM: number;
        }>;
        if (typeof j.windHours === 'number') setWindHours(j.windHours);
        if (typeof j.windLockNow === 'boolean') setWindLockNow(j.windLockNow);
        if (typeof j.safetyDepthM === 'number') setSafetyDepthM(j.safetyDepthM);
      }
    } catch {
      /* corrupt blob; ignore */
    }
    setSettingsHydrated(true);
  }, []);
  useEffect(() => {
    if (!settingsHydrated) return;
    try {
      localStorage.setItem(
        'chart:settings',
        JSON.stringify({ windHours, windLockNow, safetyDepthM }),
      );
    } catch {
      /* quota / private-mode; ignore */
    }
  }, [settingsHydrated, windHours, windLockNow, safetyDepthM]);

  // Radar UI settings — opacity + rangeM. Persisted to chart:radar (mirror of chart:settings pattern).
  // 3704 m ≈ 2 nm: first chart-visible range for most radar units.
  const [radarUi, setRadarUi] = useState<{ opacity: number; rangeM: number }>({
    opacity: 0.7,
    rangeM: 3704,
  });
  const [radarUiHydrated, setRadarUiHydrated] = useState(false);
  useEffect(() => {
    try {
      const raw = localStorage.getItem('chart:radar');
      if (raw) {
        const j = JSON.parse(raw) as Partial<{ opacity: number; rangeM: number }>;
        setRadarUi({
          opacity: typeof j.opacity === 'number' ? j.opacity : 0.7,
          rangeM: typeof j.rangeM === 'number' ? j.rangeM : 3704,
        });
      }
    } catch {
      /* corrupt blob; ignore */
    }
    setRadarUiHydrated(true);
  }, []);
  useEffect(() => {
    if (!radarUiHydrated) return;
    try {
      localStorage.setItem('chart:radar', JSON.stringify(radarUi));
    } catch {
      /* quota / private-mode; ignore */
    }
  }, [radarUiHydrated, radarUi]);

  // Mayara base URL — derived client-side from the page's own host on port 6502.
  // Computed in useEffect (SSR-safe: window/location are undefined during server render).
  // The spoke WebSocket connects to mayara directly (WS isn't CORS-bound), so we
  // derive its base from the page host on :6502. The REST API instead goes
  // through g5000's same-origin proxy at `/api/radar` (mayara sends no CORS
  // headers, so the browser can't fetch it cross-origin). SSR-safe: client only.
  const [mayaraWsBase, setMayaraWsBase] = useState('');
  useEffect(() => {
    if (typeof window !== 'undefined') {
      setMayaraWsBase(`${window.location.protocol}//${window.location.hostname}:6502`);
    }
  }, []);

  const [waypoints, setWaypoints] = useState<
    Array<{ id: string; name: string; lat: number; lon: number }>
  >([]);
  const [routes, setRoutes] = useState<Partial<Record<'GFS' | 'ECMWF', Route>>>({});
  const routePlan = useRoutePlan();
  const [showIsochrones, setShowIsochrones] = useState(false);
  const [showRouteWind, setShowRouteWind] = useState(false);
  const [playbackStates, setPlaybackStates] = useState<
    Partial<Record<'GFS' | 'ECMWF', PlaybackState>>
  >({});
  // Shared playback clock (unix s), lifted so the scrubber and the
  // route-weather panel stay in sync. Null until the scrubber initialises.
  const [playT, setPlayT] = useState<number | null>(null);
  const ROUTE_COLOR: Record<'GFS' | 'ECMWF', string> = {
    GFS: cssColor('--accent-hi', '#f59e0b'),
    ECMWF: cssColor('--route-alt', '#22d3ee'),
  };
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

  // Derive the connector path from the unified plan so the straight-line
  // preview stays in step with the pickers without a separate state slice.
  const routeWaypointPath = useMemo(
    () =>
      routePlan.ids
        .map((id) => waypoints.find((w) => w.id === id))
        .filter((w): w is (typeof waypoints)[number] => !!w)
        .map((w) => ({ lat: w.lat, lon: w.lon })),
    [routePlan.ids, waypoints],
  );

  // Draw the route connector — straight lines through the selected waypoints,
  // independent of the optimised path above. Updates live as the selection
  // changes; clears itself when fewer than two waypoints are selected.
  useEffect(() => {
    if (!mapInstance) return;
    attachRouteConnector(mapInstance, 'route-connector', routeWaypointPath);
  }, [routeWaypointPath, mapInstance]);

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

  // Keep the ROI box in sync from /api/settings regardless of the active model.
  // The wind manifest sync below also sets forecastBbox, but only for wind
  // models — without this, the CMEMS overlay would have a null/stale ROI (and
  // show the previous region) whenever no wind model had been selected. Reads on
  // mount and whenever a refresh broadcasts on 'forecast-cache'. The stabilizer
  // dedupes against the manifest sync so there's no churn.
  useEffect(() => {
    let alive = true;
    const near = (x: number, y: number): boolean => Math.abs(x - y) < 0.01;
    const read = async (): Promise<void> => {
      try {
        const r = await fetch('/api/settings', { cache: 'no-store' });
        const j = await r.json();
        const roi = j?.settings?.forecastBbox as typeof forecastBbox;
        if (!alive) return;
        setCanadianTideCurrents(j?.settings?.canadianTideCurrents === true);
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
      } catch {
        /* ignore */
      }
    };
    void read();
    const bc =
      typeof BroadcastChannel !== 'undefined' ? new BroadcastChannel('forecast-cache') : null;
    bc?.addEventListener('message', () => void read());
    return () => {
      alive = false;
      bc?.close();
    };
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
  const [ctxMenu, setCtxMenu] = useState<{
    target: ContextTarget;
    screen: { x: number; y: number };
  } | null>(null);
  // Route Start/End waypoint ids derived from the unified routePlan so the
  // marks can be badged green/red on the chart.
  const routeStartId = startOf(routePlan.ids) ?? '';
  const routeEndId = endOf(routePlan.ids) ?? '';

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
  // Returns the new waypoint's id on success, or null on failure.
  const dropWaypointAt = async ({
    lat,
    lon,
  }: {
    lat: number;
    lon: number;
  }): Promise<string | null> => {
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
        return wp.id;
      } else {
        setError('waypoint drop failed');
        return null;
      }
    } catch {
      setError('waypoint drop failed');
      return null;
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

  // Delete a waypoint by id: DELETEs from server, removes from state, and
  // removes from the active route so orphan ids don't linger.
  const handleDeleteWaypoint = async (id: string): Promise<void> => {
    try {
      await fetch(`/api/waypoints/${id}`, { method: 'DELETE' });
    } catch {
      /* ignore network errors — state update still happens */
    }
    setWaypoints((prev) => prev.filter((w) => w.id !== id));
    routePlan.removeId(id);
    setSelectedWaypointId(null);
  };

  // Right-click context menu: resolve the hit target and show the menu.
  const handleContextMenu = useCallback(
    (e: { lat: number; lon: number; point: { x: number; y: number } }) => {
      if (!mapInstance) return;
      const feats = mapInstance.queryRenderedFeatures([e.point.x, e.point.y], {
        layers: ['waypoints-dot', 'route-connector'].filter((id) => mapInstance.getLayer(id)),
      });
      // globalThis.Map — the 'Map' chart component import shadows the built-in Map here.
      const byId = new globalThis.Map<string, HitWaypoint>(
        waypoints.map((w) => [w.id, { id: w.id, name: w.name, lat: w.lat, lon: w.lon }]),
      );
      const target = resolveTarget(feats as never, {
        lat: e.lat,
        lon: e.lon,
        routeIds: routePlan.ids,
        waypointById: byId,
      });
      setCtxMenu({ target, screen: { x: e.point.x, y: e.point.y } });
    },
    [mapInstance, waypoints, routePlan.ids],
  );

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
    setPlayT(null);
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

  // Layer toggle handler — extracted so LayerDock can use the same typed key
  const handleToggleLayer = (key: LayerToggleKey): void =>
    setLayers((prev) => ({ ...prev, [key]: !prev[key] }));

  return (
    <main className="grid grid-cols-1 lg:grid-cols-[1fr_360px] flex-1 min-h-0 [&>div:first-child]:relative">
      <div className="relative">
        <Map
          center={{ lat: initialCamera.lat, lon: initialCamera.lon }}
          zoom={initialCamera.zoom}
          onLoad={(m) => {
            mapRef.current = m;
            setMapInstance(m);
          }}
          onClick={waypointDropActive ? handleDropClick : undefined}
          onContextMenu={handleContextMenu}
          onLongPress={dropWaypointAt}
          suppressLongPressLayers={['waypoints-dot']}
        />
        {ctxMenu && (
          <ChartContextMenu
            target={ctxMenu.target}
            screen={ctxMenu.screen}
            onClose={() => setCtxMenu(null)}
            onAddToRoute={(id) => routePlan.append(id)}
            onRemoveFromRoute={(id) => routePlan.removeId(id)}
            onSetStart={(id) => routePlan.setStart(id)}
            onSetEnd={(id) => routePlan.setEnd(id)}
            onDeleteWaypoint={(w) => void handleDeleteWaypoint(w.id)}
            onAddHere={(lat, lon) =>
              void dropWaypointAt({ lat, lon }).then((id) => id && routePlan.append(id))
            }
            onRouteToHere={(lat, lon) =>
              void dropWaypointAt({ lat, lon }).then((id) => id && routePlan.setEnd(id))
            }
            onInsertHere={(lat, lon, idx) =>
              void dropWaypointAt({ lat, lon }).then((id) => id && routePlan.insertAt(idx, id))
            }
            onClearRoute={() => routePlan.clear()}
          />
        )}
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
        {canadianTideCurrents && layers.tideStations && (
          <StationsOverlay map={mapInstance} kind="tide" />
        )}
        {canadianTideCurrents && layers.currentStations && (
          <StationsOverlay map={mapInstance} kind="current" />
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
          activeModel={layers.model}
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
          bbox={forecastBbox}
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
                `CMEMS daily mean for ${new Date(grid.validAt * 1000).toISOString().slice(0, 10)} (UTC)`,
              );
            }
          }}
        />
        {/* <LaylinesLayer map={mapInstance} />  disabled — not currently useful */}
        <StartLineLayer map={mapInstance} />
        <EncLayer map={mapInstance} visible={layers.enc} />
        <SatelliteLayer map={mapInstance} visible={layers.satellite} />
        <EncBuoyLayer map={mapInstance} visible={layers.buoys} />
        <BathyLayer map={mapInstance} visible={layers.bathy} safetyDepthM={safetyDepthM} />
        {layers.radar && mayaraWsBase && (
          <RadarOverlay
            map={mapInstance}
            pos={livePos}
            baseUrl="/api/radar"
            wsBase={mayaraWsBase}
            opacity={radarUi.opacity}
            rangeM={radarUi.rangeM}
          />
        )}
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
                routePlan.removeId(id);
                setSelectedWaypointId(null);
              }}
              onClose={() => setSelectedWaypointId(null)}
            />
          );
        })()}
        {/* TR tool rail — waypoint-drop toggle (AnnotationDropper moved here in T4) */}
        <div className="absolute top-2 right-2 z-10 flex flex-col gap-2 items-end">
          <button
            type="button"
            aria-pressed={waypointDropActive}
            aria-label={waypointDropActive ? 'Cancel waypoint drop' : 'Drop a waypoint'}
            title={
              waypointDropActive
                ? 'Click the map to drop a waypoint (Esc to cancel)'
                : 'Drop a waypoint on the chart'
            }
            onClick={() => setWaypointDropActive((v) => !v)}
            className={
              'w-9 h-9 rounded border flex items-center justify-center ' +
              (waypointDropActive
                ? 'bg-accent text-on-accent border-accent-strong hover:bg-accent-hi'
                : 'bg-surface/85 text-ink border-hairline-strong hover:bg-surface-raised')
            }
          >
            <svg
              width="18"
              height="18"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <path d="M12 21s-6-5.686-6-10a6 6 0 1 1 12 0c0 4.314-6 10-6 10z" />
              <circle cx="12" cy="11" r="2" />
            </svg>
          </button>
        </div>
        <MobLayer map={mapInstance} livePos={livePos} />
        <AnchorWatchLayer map={mapInstance} livePos={livePos} />
        <MapLoadingIndicator map={mapInstance} />
        <ChartFollowControl
          follow={camera.follow}
          orientation={camera.orientation}
          hasFix={livePos !== null}
          onToggleFollow={camera.toggleFollow}
          onCycleOrientation={camera.cycleOrientation}
        />
        {/* MOB sits directly under the follow/orientation stack (top-3 + 2×~34px buttons + gaps). */}
        <MobButton livePos={livePos} className="absolute left-3 top-[100px] z-10" />
        <OffscreenVesselIndicator
          map={mapInstance}
          livePos={livePos}
          visible={!camera.follow}
          onTap={camera.enterFollow}
        />
        <CursorReadout
          cursor={cursorLatLon}
          boat={livePos}
          map={mapInstance}
          wind={windGrid}
          current={currentGrid}
        />
        <TileLoadingIndicator map={mapInstance} />
      </div>
      <LayerDock
        searchLens={searchParams.get('lens')}
        layers={layers}
        onToggle={handleToggleLayer}
        onSelectModel={(model) => setLayers((prev) => ({ ...prev, model }))}
        safetyDepthM={safetyDepthM}
        onSafetyDepthM={setSafetyDepthM}
        showTideCurrents={canadianTideCurrents}
        activePreset={activePreset}
        onApplyPreset={handleApplyPreset}
        onResetToDefault={handleResetToDefault}
        routeLensProps={{
          livePos,
          waypoints,
          routePlan,
          routes,
          clock,
          routeColorMode,
          onRouteColorMode: setRouteColorMode,
          hasMotoring,
          onRouted: handleRouted,
          onClearRoute: handleClearRoute,
          showIsochrones,
          onShowIsochrones: setShowIsochrones,
          showRouteWind,
          onShowRouteWind: setShowRouteWind,
          playbackStates,
          onPlaybackStates: setPlaybackStates,
          playT,
          onPlayT: setPlayT,
          onWindHour,
          mapInstance,
          mv,
          availableHours,
          latestRunAt,
          windHours,
          windLockNow,
          windGrid,
          windStatus,
          currentStatus,
          forecastBbox,
          activeModel: layers.model,
          setWindHours,
          setWindLockNow,
          showRadar: layers.radar,
          mayaraWsBase,
          radarOpacity: radarUi.opacity,
          onRadarOpacity: (v) => setRadarUi((s) => ({ ...s, opacity: v })),
          radarRangeM: radarUi.rangeM,
          onRadarRange: (m) => setRadarUi((s) => ({ ...s, rangeM: m })),
          error,
        }}
      />
    </main>
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
  map,
  wind,
  current,
}: {
  cursor: { lat: number; lon: number } | null;
  boat: LivePos | null;
  map: maplibregl.Map | null;
  /** Wind grid sampled when present, independent of which overlay is selected. */
  wind: UvGrid | null;
  /** Current grid sampled when present, independent of which overlay is selected. */
  current: UvGrid | null;
}) {
  if (!cursor) return null;
  const hasBoat = !!boat && Number.isFinite(boat.lat) && Number.isFinite(boat.lon);
  const rangeBearing = hasBoat
    ? {
        distNm: greatCircleNm({ lat: boat!.lat, lon: boat!.lon }, cursor),
        bearingDeg: bearingDeg({ lat: boat!.lat, lon: boat!.lon }, cursor),
      }
    : null;
  // Nearest isobath depth from the GEBCO contour layer. Works even when the
  // visible layer is toggled off because BathyLayer keeps it mounted with
  // line-opacity 0 (so queryRenderedFeatures still returns features). Contours
  // are LINES not a field, so we report the nearest line's depth, not an
  // interpolated point depth (which would need the 7 GB grid online).
  const depthM = map ? nearestContourDepth(map, cursor) : null;
  // Wind/current at the cursor, sampled from whichever grids happen to be
  // loaded — independent of which overlay (if any) is currently being painted
  // on the chart, so the readout doesn't disappear when the overlay is hidden.
  const windLine = formatCursorUv(wind, cursor, 'wind');
  const currentLine = formatCursorUv(current, cursor, 'current');
  return (
    <div className="fixed bottom-3 right-3 z-30 px-3 py-2 bg-slate-900/85 border border-slate-700 text-slate-200 text-xs font-mono rounded shadow pointer-events-none leading-tight">
      <div>{fmtLatLonDmm(cursor.lat, cursor.lon)}</div>
      {windLine && <div className="text-sky-200 mt-1">{windLine}</div>}
      {currentLine && <div className="text-teal-200 mt-1">{currentLine}</div>}
      {depthM != null && (
        <div className="text-cyan-200 mt-1">Depth ≈ {depthM} m (nearest isobath)</div>
      )}
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

/**
 * Format a u/v grid sample at the cursor as a single readable line. Wind uses
 * the meteorological convention "FROM" (the direction it blows out of);
 * current uses "SET" (the direction it flows toward). Returns null if the grid
 * is missing or the cursor is outside the grid's coverage.
 */
function formatCursorUv(
  grid: UvGrid | null,
  cursor: { lat: number; lon: number },
  kind: 'wind' | 'current',
): string | null {
  if (!grid) return null;
  const uv = sampleUV(grid, cursor.lat, cursor.lon);
  if (!uv) return null;
  const speedKn = Math.hypot(uv.u, uv.v) * MS_TO_KN;
  if (kind === 'wind') {
    const fromDeg = (Math.atan2(-uv.u, -uv.v) * 180) / Math.PI;
    const d = ((fromDeg % 360) + 360) % 360;
    return `Wind ${speedKn.toFixed(1)} kn · ${cardinal16(d)} (${d.toFixed(0).padStart(3, '0')}°)`;
  }
  const setDeg = (Math.atan2(uv.u, uv.v) * 180) / Math.PI;
  const d = ((setDeg % 360) + 360) % 360;
  return `Current ${speedKn.toFixed(1)} kn · set ${cardinal16(d)} (${d.toFixed(0).padStart(3, '0')}°)`;
}

/**
 * Depth of the bathy contour line nearest the cursor in pixel space across the
 * whole viewport, or null if no contour features are rendered (e.g. the source
 * hasn't loaded a tile yet, or we're over an area with no bathy at this zoom).
 * Works regardless of whether the user has toggled Depth (GEBCO) visible —
 * BathyLayer keeps the layer mounted with line-opacity 0 when "off" so
 * queryRenderedFeatures still returns features.
 *
 * Per-mousemove cost is O(total vertices in viewport) project() calls. At z6
 * over Bermuda that's ~50–100k vertices and a few ms; if a future zoom level
 * shows lag, switch to a two-stage filter (feature centroid → top-N → all
 * vertices).
 */
function nearestContourDepth(
  map: maplibregl.Map,
  cursor: { lat: number; lon: number },
): number | null {
  if (!map.getLayer('bathy-contour-line')) return null;
  let feats: maplibregl.MapGeoJSONFeature[] = [];
  try {
    feats = map.queryRenderedFeatures(undefined, { layers: ['bathy-contour-line'] });
  } catch {
    return null; // style not ready
  }
  if (!feats.length) return null;
  const p = map.project([cursor.lon, cursor.lat]);
  let bestSq = Infinity;
  let bestDepth: number | null = null;
  for (const f of feats) {
    const g = f.geometry as GeoJSON.LineString | GeoJSON.MultiLineString;
    const lines: GeoJSON.Position[][] =
      g.type === 'LineString' ? [g.coordinates] : g.type === 'MultiLineString' ? g.coordinates : [];
    for (const line of lines) {
      for (const c of line) {
        const q = map.project([c[0]!, c[1]!]);
        const dx = q.x - p.x;
        const dy = q.y - p.y;
        const sq = dx * dx + dy * dy;
        if (sq < bestSq) {
          bestSq = sq;
          bestDepth = (f.properties as { depth?: number } | null)?.depth ?? null;
        }
      }
    }
  }
  return bestDepth;
}
