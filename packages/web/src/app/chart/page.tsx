'use client';
import { Suspense, useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import maplibregl from 'maplibre-gl';
import { Map } from '../../components/Map';
import { StatusBadge } from '../../components/StatusBadge';
import { PlanControls, type PlanRequest } from '../../components/PlanControls';
import { attachRoute } from '../../components/RoutePolyline';
import { RouteTimeline } from '../../components/RouteTimeline';
import { LiveBoatMarker, type LivePos } from '../../components/LiveBoatMarker';
import { AisTargets } from '../../components/AisTargets';
import { ForecastRoi } from '../../components/ForecastRoi';
import { WaypointsLayer, type MarkLike } from '../../components/WaypointsLayer';
import { GulfStreamLayer } from '../../components/GulfStreamLayer';
import { fmtLatLonDmm } from '../../lib/format-coords';
// DriftArrow removed at user's request; computation kept on /helm via the
// shared @g5000/compute helper. If the chart needs set+drift back, prefer
// pulling it from /api/position rather than re-deriving here.
import { WindOverlay, type WindGrid, type WindModel } from '../../components/WindOverlay';
import { CurrentOverlay } from '../../components/CurrentOverlay';
import { StartLineLayer } from '../../components/StartLineLayer';
import { LaylinesLayer } from '../../components/LaylinesLayer';
import { SeamarkLayer } from '../../components/SeamarkLayer';
import { CogExtension } from '../../components/CogExtension';
import { LayersControl, type LayersState } from './LayersControl';
import { TzToggle } from '../../components/TzToggle';
import { fmtHourLabel, readTzMode, writeTzMode, type TzMode } from '../../lib/tz';
import type { Route } from '@g5000/routing';

type Pos = { lat: number; lon: number };

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
  const [windHours, setWindHours] = useState(0);
  const [windModel, setWindModel] = useState<WindModel>('gfs');
  // Default off — at the user's request. Wind overlay is heavy and most
  // helm-time looks don't need it; toggle on when checking conditions.
  const [windOn, setWindOn] = useState(false);
  // Bumped automatically whenever the user moves the timeline / model so the
  // chart re-reads from the cache. Fetching itself happens on /forecast.
  const [windRefreshKey, setWindRefreshKey] = useState(1);
  const [windGrid, setWindGrid] = useState<WindGrid | null>(null);
  const [windStatus, setWindStatus] = useState<string | null>(null);
  const [currentRefreshKey, setCurrentRefreshKey] = useState(1);
  const [currentStatus, setCurrentStatus] = useState<string | null>(null);
  const [currentFetching, setCurrentFetching] = useState(false);
  const [availableHours, setAvailableHours] = useState<{ gfs: number[]; ecmwf: number[] }>({
    gfs: [],
    ecmwf: [],
  });
  const [latestRunAt, setLatestRunAt] = useState<{ gfs: number | null; ecmwf: number | null }>({
    gfs: null,
    ecmwf: null,
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
  // Default off — at the user's request. Isochrones add chart clutter and
  // are mostly useful when actively investigating a planned route's fan-out.
  const [showIsochrones, setShowIsochrones] = useState(false);
  const [displayModel, setDisplayModel] = useState<'GFS' | 'ECMWF' | 'CMEMS'>('GFS');

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
          windOn: boolean;
          windModel: WindModel;
          windHours: number;
          displayModel: 'GFS' | 'ECMWF' | 'CMEMS';
          showIsochrones: boolean;
        }>;
        if (typeof j.windOn === 'boolean') setWindOn(j.windOn);
        if (j.windModel === 'gfs' || j.windModel === 'ecmwf') setWindModel(j.windModel);
        if (typeof j.windHours === 'number') setWindHours(j.windHours);
        if (j.displayModel === 'GFS' || j.displayModel === 'ECMWF' || j.displayModel === 'CMEMS') {
          setDisplayModel(j.displayModel);
        }
        if (typeof j.showIsochrones === 'boolean') setShowIsochrones(j.showIsochrones);
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
        JSON.stringify({ windOn, windModel, windHours, displayModel, showIsochrones }),
      );
    } catch {
      /* quota / private-mode; ignore */
    }
  }, [settingsHydrated, windOn, windModel, windHours, displayModel, showIsochrones]);

  const [start, setStart] = useState<Pos | undefined>();
  const [end, setEnd] = useState<Pos | undefined>();
  const [waypoints, setWaypoints] = useState<
    Array<{ id: string; name: string; lat: number; lon: number }>
  >([]);
  const [loading, setLoading] = useState(false);
  const [route, setRoute] = useState<Route | undefined>();
  const [error, setError] = useState<string | undefined>();
  const [savedMsg, setSavedMsg] = useState<string | undefined>();
  const [saving, setSaving] = useState(false);

  // Re-attach the route whenever it changes (planned, restored from
  // localStorage, isochrone-toggle, or map first comes online). attachRoute
  // is idempotent — same source/layer id just updates the data — so calling
  // it on each change is cheap.
  useEffect(() => {
    if (route && mapInstance) {
      attachRoute(mapInstance, 'route-gfs', route, '#000000', showIsochrones);
    }
  }, [route, mapInstance, showIsochrones]);

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
    let alive = true;
    const tick = async (): Promise<void> => {
      try {
        const r = await fetch('/api/forecast/manifest', { cache: 'no-store' });
        const j = await r.json();
        if (!alive || !j.ok) return;
        const gfs = new Set<number>();
        const ecmwf = new Set<number>();
        let gfsRun: number | null = null;
        let ecmwfRun: number | null = null;
        for (const e of j.entries as Array<{
          model: 'gfs' | 'ecmwf';
          forecastHour: number;
          runAt: number;
        }>) {
          (e.model === 'gfs' ? gfs : ecmwf).add(e.forecastHour);
          if (e.model === 'gfs') gfsRun = Math.max(gfsRun ?? 0, e.runAt);
          else ecmwfRun = Math.max(ecmwfRun ?? 0, e.runAt);
        }
        setAvailableHours({
          gfs: [...gfs].sort((a, b) => a - b),
          ecmwf: [...ecmwf].sort((a, b) => a - b),
        });
        setLatestRunAt({ gfs: gfsRun, ecmwf: ecmwfRun });
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
  }, []);

  // When the manifest changes or timeline moves, bump refreshKey so the
  // overlay re-reads from the cache.
  useEffect(() => {
    if (livePos === null) return;
    setWindRefreshKey((k) => k + 1);
  }, [windModel, windHours, livePos?.lat, livePos?.lon, availableHours]);

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
        const saved = JSON.parse(raw) as { route?: Route };
        if (saved.route) setRoute(saved.route);
      }
    } catch {
      /* corrupt or quota — drop it on the floor */
    }
    setRestored(true);
  }, []);

  // Persist the route. Start/end are deliberately omitted — see comment on
  // the restore effect above.
  useEffect(() => {
    if (!restored) return;
    try {
      localStorage.setItem('chart:planState', JSON.stringify({ route }));
    } catch {
      /* quota or disabled — silently drop */
    }
  }, [route, restored]);

  // Layer visibility — which chart overlays are currently on. Seamarks
  // default on so the chart shows navigation marks on first visit.
  const [layers, setLayers] = useState<LayersState>(() => {
    if (typeof window === 'undefined') return { seamarks: true };
    try {
      const raw = window.localStorage.getItem('chart:layers');
      if (!raw) return { seamarks: true };
      const parsed = JSON.parse(raw) as Partial<LayersState>;
      return { seamarks: parsed.seamarks ?? true };
    } catch {
      return { seamarks: true };
    }
  });
  useEffect(() => {
    if (typeof window === 'undefined') return;
    try {
      window.localStorage.setItem('chart:layers', JSON.stringify(layers));
    } catch {
      /* private-mode / quota exceeded — ignore */
    }
  }, [layers]);

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
        setRoute(j.plan.route);
        // Seed start/end from the route's first/last leg so the markers
        // on the chart reflect where this plan actually goes.
        const legs = j.plan.route.legs;
        if (legs.length > 0) {
          const first = legs[0]!;
          const last = legs[legs.length - 1]!;
          setStart({ lat: first.lat, lon: first.lon });
          setEnd({ lat: last.lat, lon: last.lon });
        }
      } catch (e) {
        setError(String(e));
      }
    })();
  }, [planIdFromUrl]);

  // Auto-preselect of start/end on mount has been removed at the user's
  // request — the chart loads empty and the user picks start/end via map
  // clicks, the "Use boat position" button, or a saved-plan load.

  const onMapClick = (p: Pos) => {
    if (!start) setStart(p);
    else if (!end) setEnd(p);
    else {
      setStart(p);
      setEnd(undefined);
      setRoute(undefined);
    }
  };
  const onPlan = async (req: PlanRequest) => {
    setLoading(true);
    setError(undefined);
    try {
      const res = await fetch('/api/route/plan', {
        method: 'POST',
        body: JSON.stringify(req),
        headers: { 'content-type': 'application/json' },
      });
      const j = await res.json();
      if (!j.ok) throw new Error(j.error?.message ?? 'plan failed');
      setRoute(j.route);
      // attach is handled by the effect on [route, mapInstance,
      // showIsochrones] above — no need to call it inline here.
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  };
  const onSave = async () => {
    if (!route) return;
    const name = window.prompt('Plan name?');
    if (!name || !name.trim()) return;
    setSaving(true);
    setSavedMsg(undefined);
    try {
      const res = await fetch('/api/plans', {
        method: 'POST',
        body: JSON.stringify({ name: name.trim(), route }),
        headers: { 'content-type': 'application/json' },
      });
      const j = await res.json();
      if (!j.ok) throw new Error(j.error?.message ?? 'save failed');
      setSavedMsg(`Saved as ${name.trim()}`);
      setTimeout(() => setSavedMsg(undefined), 3000);
    } catch (e) {
      setError(String(e));
    } finally {
      setSaving(false);
    }
  };
  return (
    <main className="grid grid-cols-[1fr_360px] h-full [&>div:first-child]:relative">
      <div className="relative">
        <Map
          center={{ lat: initialCamera.lat, lon: initialCamera.lon }}
          zoom={initialCamera.zoom}
          onClick={onMapClick}
          onLoad={(m) => {
            mapRef.current = m;
            setMapInstance(m);
          }}
        />
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
        <AisTargets map={mapInstance} cogExtensionMinutes={COG_EXTENSION_MINUTES} />
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
        />
        <GulfStreamLayer map={mapInstance} />
        <WaypointsLayer
          map={mapInstance}
          marks={(() => {
            const list: MarkLike[] = waypoints.map((w) => ({
              lat: w.lat,
              lon: w.lon,
              name: w.name,
            }));
            if (start) list.push({ lat: start.lat, lon: start.lon, name: 'start', badge: 'S' });
            if (end) list.push({ lat: end.lat, lon: end.lon, name: 'end', badge: 'E' });
            return list;
          })()}
        />
        <WindOverlay
          map={mapInstance}
          centerLat={livePos?.lat ?? null}
          centerLon={livePos?.lon ?? null}
          model={windModel}
          hours={windHours}
          hidden={!windOn || displayModel === 'CMEMS'}
          opacity={0.5}
          showFill={true}
          showBarbs={true}
          showIsobars={true}
          refreshKey={windRefreshKey}
          onLoaded={({ grid, identical, error }) => {
            if (error) {
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
          hidden={!windOn || displayModel !== 'CMEMS'}
          day={0}
          opacity={0.85}
          refreshKey={currentRefreshKey}
          onLoaded={({ grid, error }) => {
            if (error === 'not cached') {
              setCurrentStatus('No CMEMS grid cached. Click Refresh.');
            } else if (error) {
              setCurrentStatus(`Error: ${error}`);
            } else if (grid) {
              const ageH = Math.round((Date.now() / 1000 - grid.validAt) / 3600);
              setCurrentStatus(
                `CMEMS daily mean for ${new Date(grid.validAt * 1000).toISOString().slice(0, 10)}`,
              );
            }
          }}
        />
        {/* <LaylinesLayer map={mapInstance} />  disabled — not currently useful */}
        <StartLineLayer map={mapInstance} />
        <SeamarkLayer map={mapInstance} visible={layers.seamarks} />
        <LayersControl
          state={layers}
          onToggle={(key) => setLayers((prev) => ({ ...prev, [key]: !prev[key] }))}
        />
        <div className="absolute top-3 left-3 flex flex-col gap-2 items-start">
          {livePos && (
            <button
              type="button"
              onClick={() => {
                if (mapRef.current) {
                  mapRef.current.flyTo({
                    center: [livePos.lon, livePos.lat],
                    zoom: Math.max(mapRef.current.getZoom(), 9),
                    speed: 1.4,
                  });
                }
              }}
              className="px-3 py-1.5 bg-slate-900/85 hover:bg-slate-800 border border-slate-700 text-slate-200 text-sm rounded shadow"
              title="Pan map to boat's current position"
            >
              ⊕ Center on boat
            </button>
          )}
        </div>
        <CursorReadout cursor={cursorLatLon} boat={livePos} />
      </div>
      <aside className="p-4 border-l border-slate-800 space-y-4 overflow-y-auto">
        <div className="flex items-center justify-between">
          <StatusBadge />
          <TzToggle tz={tz} setTz={setTz} />
        </div>
        <LiveValues p={livePos} />
        <div className="space-y-2 bg-slate-900/60 border border-slate-800 rounded p-2">
          <div className="flex items-center justify-between text-sm">
            <span className="text-slate-400 font-medium">Model display</span>
            <label className="flex items-center gap-1 text-xs">
              <input
                type="checkbox"
                checked={windOn}
                onChange={(e) => setWindOn(e.target.checked)}
              />
              <span className="text-slate-300">visible</span>
            </label>
          </div>
          <div className="flex gap-2 items-center text-xs">
            <label className="flex items-center gap-1">
              <span className="text-slate-400">Model</span>
              <select
                value={displayModel}
                onChange={(e) => {
                  const m = e.target.value as 'GFS' | 'ECMWF' | 'CMEMS';
                  setDisplayModel(m);
                  // GFS/ECMWF select wind grids; CMEMS is surface currents
                  // — keep windModel in sync so the overlay/hours slider
                  // reads from the right cache.
                  if (m === 'GFS') setWindModel('gfs');
                  else if (m === 'ECMWF') setWindModel('ecmwf');
                  // CMEMS leaves windModel alone — currents overlay is a
                  // separate render path.
                }}
                className="bg-slate-900 border border-slate-700 rounded px-1 py-0.5 text-slate-200"
              >
                <option value="GFS">
                  GFS (wind){availableHours.gfs.length ? '' : ' (no cache)'}
                </option>
                <option value="ECMWF">
                  ECMWF (wind){availableHours.ecmwf.length ? '' : ' (no cache)'}
                </option>
                <option value="CMEMS">CMEMS (currents)</option>
              </select>
            </label>
          </div>
          {displayModel === 'CMEMS' && (
            <div className="text-xs space-y-1 pt-1 border-t border-slate-800 mt-1">
              <p className="text-slate-400">
                Surface currents from Copernicus Marine (CMEMS) daily-mean global analysis (1/12°,
                surface depth). Colour = speed in knots; arrows = direction.
              </p>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  disabled={currentFetching}
                  onClick={async () => {
                    setCurrentFetching(true);
                    setCurrentStatus('Fetching CMEMS…');
                    try {
                      // Western North Atlantic — covers Bermuda → New England
                      // and the full Gulf Stream meander region.
                      const r = await fetch('/api/current/refresh', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                          bbox: { latMin: 20, latMax: 50, lonMin: -82, lonMax: -40 },
                          days: [0],
                        }),
                      });
                      const j = (await r.json()) as {
                        ok: boolean;
                        results?: Array<{ day: number; ok: boolean; error?: string }>;
                        error?: { message?: string };
                      };
                      if (!j.ok || !j.results?.[0]?.ok) {
                        const err = j.results?.[0]?.error ?? j.error?.message ?? 'fetch failed';
                        setCurrentStatus(`Refresh failed: ${err}`);
                      } else {
                        setCurrentStatus('Refresh OK');
                        setCurrentRefreshKey((k) => k + 1);
                      }
                    } catch (e) {
                      setCurrentStatus(`Refresh error: ${(e as Error).message}`);
                    } finally {
                      setCurrentFetching(false);
                    }
                  }}
                  className="px-2 py-1 bg-amber-700 hover:bg-amber-600 disabled:opacity-50 text-amber-100 rounded font-medium"
                >
                  {currentFetching ? 'Fetching…' : 'Refresh CMEMS'}
                </button>
                {currentStatus && <span className="text-slate-400">{currentStatus}</span>}
              </div>
            </div>
          )}
          {/* Wind-forecast timeline (run, valid time, hour stepper). Hidden
              when the user has CMEMS selected — currents are a daily mean
              and don't have an hour-stepped slider. */}
          {displayModel !== 'CMEMS' &&
            (() => {
              const fullList = availableHours[windModel];
              if (fullList.length === 0) {
                return (
                  <div className="text-xs text-amber-300">
                    No {windModel.toUpperCase()} forecast cached. Visit{' '}
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
              const runAt = latestRunAt[windModel];
              const nowS = Date.now() / 1000;
              const list = runAt
                ? fullList.filter((h) => runAt + h * 3600 >= nowS - 1800) // 30 min grace
                : fullList;
              if (list.length === 0) {
                return (
                  <div className="text-xs text-amber-300">
                    {windModel.toUpperCase()} forecast cache is stale (all valid times in the past).
                    Refresh on{' '}
                    <a href="/forecast" className="underline">
                      Forecast
                    </a>
                    .
                  </div>
                );
              }
              const idx = list.indexOf(windHours);
              const effectiveIdx = idx >= 0 ? idx : 0;
              const effectiveHours = list[effectiveIdx]!;
              if (effectiveHours !== windHours) {
                setTimeout(() => setWindHours(effectiveHours), 0);
              }
              const goPrev = (): void => {
                if (effectiveIdx > 0) setWindHours(list[effectiveIdx - 1]!);
              };
              const goNext = (): void => {
                if (effectiveIdx < list.length - 1) setWindHours(list[effectiveIdx + 1]!);
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
                  <input
                    type="range"
                    min={list[0]}
                    max={list[list.length - 1]}
                    step={1}
                    value={effectiveHours}
                    onChange={(e) => {
                      const v = Number(e.target.value);
                      const nearest = list.reduce(
                        (best, h) => (Math.abs(h - v) < Math.abs(best - v) ? h : best),
                        list[0]!,
                      );
                      setWindHours(nearest);
                    }}
                    className="block w-full"
                  />
                </div>
              );
            })()}
          {displayModel !== 'CMEMS' && windGrid && (
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
          {displayModel !== 'CMEMS' && windStatus && (
            <div className="text-xs text-emerald-300">{windStatus}</div>
          )}
          <label className="flex items-center gap-2 text-xs pt-1 border-t border-slate-800 mt-2">
            <input
              type="checkbox"
              checked={showIsochrones}
              onChange={(e) => setShowIsochrones(e.target.checked)}
            />
            <span className="text-slate-300">Show isochrones</span>
          </label>
        </div>
        <div className="space-y-2 bg-slate-900/60 border border-slate-800 rounded p-2">
          <div className="space-y-1">
            <div className="flex items-center gap-2 text-xs">
              <span className="text-slate-400 w-10">Start:</span>
              <span className="font-mono text-slate-200 flex-1">
                {start ? fmtLatLonDmm(start.lat, start.lon) : '— click map'}
              </span>
              {start && (
                <button
                  type="button"
                  onClick={() => setStart(undefined)}
                  className="text-[10px] px-1 py-0.5 bg-slate-800 hover:bg-slate-700 rounded"
                  title="Clear start"
                >
                  ×
                </button>
              )}
            </div>
            <div className="flex gap-1 items-center text-xs">
              <button
                type="button"
                onClick={() => {
                  if (livePos) setStart({ lat: livePos.lat, lon: livePos.lon });
                }}
                disabled={!livePos}
                className="px-2 py-1 bg-slate-700 hover:bg-amber-600 hover:text-slate-900 rounded disabled:opacity-40"
              >
                Use boat position
              </button>
              <select
                value=""
                onChange={(e) => {
                  const w = waypoints.find((x) => x.id === e.target.value);
                  if (w) setStart({ lat: w.lat, lon: w.lon });
                  e.currentTarget.value = '';
                }}
                className="bg-slate-900 border border-slate-700 rounded px-1 py-1 text-slate-200 flex-1"
              >
                <option value="">Waypoint…</option>
                {waypoints.map((w) => (
                  <option key={w.id} value={w.id}>
                    {w.name}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <div className="space-y-1 pt-1 border-t border-slate-800">
            <div className="flex items-center gap-2 text-xs">
              <span className="text-slate-400 w-10">End:</span>
              <span className="font-mono text-slate-200 flex-1">
                {end ? fmtLatLonDmm(end.lat, end.lon) : '— click map'}
              </span>
              {end && (
                <button
                  type="button"
                  onClick={() => setEnd(undefined)}
                  className="text-[10px] px-1 py-0.5 bg-slate-800 hover:bg-slate-700 rounded"
                  title="Clear end"
                >
                  ×
                </button>
              )}
            </div>
            <div className="flex gap-1 items-center text-xs">
              <select
                value=""
                onChange={(e) => {
                  const w = waypoints.find((x) => x.id === e.target.value);
                  if (w) setEnd({ lat: w.lat, lon: w.lon });
                  e.currentTarget.value = '';
                }}
                className="bg-slate-900 border border-slate-700 rounded px-1 py-1 text-slate-200 flex-1"
              >
                <option value="">Waypoint…</option>
                {waypoints.map((w) => (
                  <option key={w.id} value={w.id}>
                    {w.name}
                  </option>
                ))}
              </select>
            </div>
          </div>
        </div>
        <PlanControls start={start} end={end} onPlan={onPlan} loading={loading} tz={tz} />
        <SavedPlanLoader
          onLoad={(plan) => {
            setRoute(plan.route);
            const legs = plan.route.legs;
            if (legs.length > 0) {
              const first = legs[0]!;
              const last = legs[legs.length - 1]!;
              setStart({ lat: first.lat, lon: first.lon });
              setEnd({ lat: last.lat, lon: last.lon });
            }
          }}
        />
        {error && <div className="text-rose-400 text-xs">{error}</div>}
        {route && (
          <div className="text-xs text-slate-300">
            ETA: {fmtHourLabel(route.end, tz)}
            <br />
            Distance: {(route.distance / 1852).toFixed(0)} NM
            <br />
            Model: {route.model}
            {route.incomplete ? ` (incomplete: ${route.reason})` : ''}
          </div>
        )}
        {route && (
          <button
            type="button"
            onClick={onSave}
            disabled={saving}
            className="w-full text-sm bg-emerald-700 hover:bg-emerald-600 disabled:bg-slate-700 disabled:text-slate-400 text-white py-2 rounded"
          >
            {saving ? 'Saving…' : 'Save plan'}
          </button>
        )}
        {savedMsg && <div className="text-xs text-emerald-400">{savedMsg}</div>}
        {route && <RouteTimeline route={route} />}
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

interface PlanRecord {
  id: string;
  name: string;
  createdAt: number;
  route: Route;
}

/**
 * Dropdown of saved plans. Selecting one fetches the full plan and calls
 * `onLoad` so the parent can install the route + start/end markers on
 * the map. Reads from /api/plans on mount and refreshes on focus.
 */
function SavedPlanLoader({ onLoad }: { onLoad: (plan: PlanRecord) => void }) {
  const [items, setItems] = useState<PlanRecord[]>([]);
  const [loadingPlanId, setLoadingPlanId] = useState<string | null>(null);
  const refresh = (): void => {
    void fetch('/api/plans', { cache: 'no-store' })
      .then((r) => r.json())
      .then((j: { ok?: boolean; items?: PlanRecord[] }) => {
        if (j.ok && Array.isArray(j.items))
          setItems(j.items.sort((a, b) => b.createdAt - a.createdAt));
      })
      .catch(() => {
        /* ignore */
      });
  };
  useEffect(() => {
    refresh();
    const onFocus = (): void => refresh();
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, []);
  const handleSelect = async (id: string): Promise<void> => {
    if (!id) return;
    setLoadingPlanId(id);
    try {
      const r = await fetch(`/api/plans/${id}`, { cache: 'no-store' });
      const j = (await r.json()) as
        | { ok: true; plan: PlanRecord }
        | { ok: false; error?: { message?: string } };
      if (j.ok) onLoad(j.plan);
    } finally {
      setLoadingPlanId(null);
    }
  };
  if (items.length === 0) return null;
  return (
    <div className="space-y-1">
      <label className="block text-xs text-slate-400">
        Load saved plan
        <select
          value=""
          disabled={loadingPlanId !== null}
          onChange={(e) => {
            const id = e.currentTarget.value;
            e.currentTarget.value = '';
            void handleSelect(id);
          }}
          className="block w-full bg-slate-900 border border-slate-700 rounded px-2 py-1 mt-1 text-slate-200 disabled:opacity-50"
        >
          <option value="">— pick a saved plan —</option>
          {items.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name} · {(p.route.distance / 1852).toFixed(0)} NM
            </option>
          ))}
        </select>
      </label>
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
}: {
  cursor: { lat: number; lon: number } | null;
  boat: LivePos | null;
}) {
  if (!cursor) return null;
  const hasBoat = !!boat && Number.isFinite(boat.lat) && Number.isFinite(boat.lon);
  const rangeBearing = hasBoat
    ? haversineAndBearing({ lat: boat!.lat, lon: boat!.lon }, cursor)
    : null;
  return (
    <div className="fixed bottom-3 left-3 z-30 px-3 py-2 bg-slate-900/85 border border-slate-700 text-slate-200 text-xs font-mono rounded shadow pointer-events-none leading-tight">
      <div>{fmtLatLonDmm(cursor.lat, cursor.lon)}</div>
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
