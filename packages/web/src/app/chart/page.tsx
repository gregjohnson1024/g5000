'use client';
import { useEffect, useRef, useState } from 'react';
import maplibregl from 'maplibre-gl';
import { Map } from '../../components/Map';
import { StatusBadge } from '../../components/StatusBadge';
import { PlanControls, type PlanRequest } from '../../components/PlanControls';
import { attachRoute } from '../../components/RoutePolyline';
import { RouteTimeline } from '../../components/RouteTimeline';
import { LiveBoatMarker, type LivePos } from '../../components/LiveBoatMarker';
import { AisTargets } from '../../components/AisTargets';
import { WaypointsLayer, type MarkLike } from '../../components/WaypointsLayer';
import { fmtLatLonDmm } from '../../lib/format-coords';
// DriftArrow removed at user's request; computation kept on /helm via the
// shared @g5000/compute helper. If the chart needs set+drift back, prefer
// pulling it from /api/position rather than re-deriving here.
import { WindOverlay, type WindGrid, type WindModel } from '../../components/WindOverlay';
import { CogExtension } from '../../components/CogExtension';
import type { Route } from '@g5000/routing';

type Pos = { lat: number; lon: number };

export default function HomePage() {
  const mapRef = useRef<maplibregl.Map | null>(null);
  const [mapInstance, setMapInstance] = useState<maplibregl.Map | null>(null);
  const [livePos, setLivePos] = useState<LivePos | null>(null);
  const [windHours, setWindHours] = useState(0);
  const [windModel, setWindModel] = useState<WindModel>('gfs');
  const [windOn, setWindOn] = useState(true);
  // Bumped automatically whenever the user moves the timeline / model so the
  // chart re-reads from the cache. Fetching itself happens on /forecast.
  const [windRefreshKey, setWindRefreshKey] = useState(1);
  const [windGrid, setWindGrid] = useState<WindGrid | null>(null);
  const [windStatus, setWindStatus] = useState<string | null>(null);
  const [availableHours, setAvailableHours] = useState<{ gfs: number[]; ecmwf: number[] }>({
    gfs: [],
    ecmwf: [],
  });
  const [roiSaveStatus, setRoiSaveStatus] = useState<string | null>(null);
  const [showIsochrones, setShowIsochrones] = useState(true);
  const [displayModel, setDisplayModel] = useState<'GFS' | 'ECMWF' | 'RTOFS'>('GFS');

  // Toggling isochrones after a route is planned re-attaches the route
  // with the new flag, which clears or rebuilds the isochrones layer
  // without needing to re-plan.
  useEffect(() => {
    if (route && mapRef.current) {
      attachRoute(mapRef.current, 'route-gfs', route, '#000000', showIsochrones);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showIsochrones]);

  const saveRoiFromView = async (): Promise<void> => {
    const map = mapRef.current;
    if (!map) return;
    const b = map.getBounds();
    const bbox = {
      latMin: b.getSouth(),
      latMax: b.getNorth(),
      lonMin: b.getWest(),
      lonMax: b.getEast(),
    };
    try {
      const r = await fetch('/api/settings');
      const prev = (await r.json())?.settings ?? {};
      const next = { ...prev, forecastBbox: bbox };
      const put = await fetch('/api/settings', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(next),
      });
      if (!put.ok) throw new Error(`HTTP ${put.status}`);
      setRoiSaveStatus(
        `ROI saved: ${bbox.latMin.toFixed(1)}–${bbox.latMax.toFixed(1)}°N, ` +
          `${Math.abs(bbox.lonMax).toFixed(1)}–${Math.abs(bbox.lonMin).toFixed(1)}°W`,
      );
    } catch (e) {
      setRoiSaveStatus(`save failed: ${String(e)}`);
    }
    setTimeout(() => setRoiSaveStatus(null), 4000);
  };
  const [start, setStart] = useState<Pos | undefined>();
  const [end, setEnd] = useState<Pos | undefined>();
  const [waypoints, setWaypoints] = useState<Array<{ id: string; name: string; lat: number; lon: number }>>([]);
  const [loading, setLoading] = useState(false);
  const [route, setRoute] = useState<Route | undefined>();
  const [error, setError] = useState<string | undefined>();
  const [savedMsg, setSavedMsg] = useState<string | undefined>();
  const [saving, setSaving] = useState(false);

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
        for (const e of j.entries as Array<{ model: 'gfs' | 'ecmwf'; forecastHour: number }>) {
          (e.model === 'gfs' ? gfs : ecmwf).add(e.forecastHour);
        }
        setAvailableHours({
          gfs: [...gfs].sort((a, b) => a - b),
          ecmwf: [...ecmwf].sort((a, b) => a - b),
        });
      } catch {
        /* ignore */
      }
    };
    void tick();

    const bc = typeof BroadcastChannel !== 'undefined' ? new BroadcastChannel('forecast-cache') : null;
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
      if (mapRef.current) {
        attachRoute(mapRef.current, 'route-gfs', j.route, '#000000', showIsochrones);
      }
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
          center={{ lat: 35, lon: -70 }}
          zoom={4}
          onClick={onMapClick}
          onLoad={(m) => {
            mapRef.current = m;
            setMapInstance(m);
          }}
        />
        <LiveBoatMarker map={mapInstance} onUpdate={setLivePos} />
        <CogExtension map={mapInstance} p={livePos} hidden={false} />
        <AisTargets map={mapInstance} />
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
          hidden={!windOn}
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
          <button
            type="button"
            onClick={() => void saveRoiFromView()}
            className="px-3 py-1.5 bg-slate-900/85 hover:bg-slate-800 border border-slate-700 text-slate-200 text-sm rounded shadow"
            title="Save current map view as the forecast refresh ROI (picked up by the 3 h timer on the Pi)"
          >
            ▣ Save view as ROI
          </button>
          {roiSaveStatus && (
            <div className="px-2 py-1 bg-slate-900/85 border border-slate-700 text-slate-300 text-xs rounded shadow font-mono">
              {roiSaveStatus}
            </div>
          )}
        </div>
      </div>
      <aside className="p-4 border-l border-slate-800 space-y-4 overflow-y-auto">
        <StatusBadge />
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
                  const m = e.target.value as 'GFS' | 'ECMWF' | 'RTOFS';
                  setDisplayModel(m);
                  // GFS/ECMWF select wind grids; RTOFS is surface currents
                  // — keep windModel in sync so the overlay/hours slider
                  // reads from the right cache.
                  if (m === 'GFS') setWindModel('gfs');
                  else if (m === 'ECMWF') setWindModel('ecmwf');
                  // RTOFS leaves windModel alone — currents overlay is a
                  // separate render path (TODO when /api/currents lands).
                }}
                className="bg-slate-900 border border-slate-700 rounded px-1 py-0.5 text-slate-200"
              >
                <option value="GFS">
                  GFS (wind){availableHours.gfs.length ? '' : ' (no cache)'}
                </option>
                <option value="ECMWF">
                  ECMWF (wind){availableHours.ecmwf.length ? '' : ' (no cache)'}
                </option>
                <option value="RTOFS">RTOFS (currents)</option>
              </select>
            </label>
          </div>
          {displayModel === 'RTOFS' && (
            <div className="text-xs space-y-1 pt-1 border-t border-slate-800 mt-1">
              <p className="text-slate-400">
                Native RTOFS rendering pending. For now, open the
                surface-current view on earth.nullschool — same data
                (NOAA RTOFS), centred on your position. Best public
                view of the Gulf Stream meanders and eddies.
              </p>
              <a
                href={(() => {
                  const lon = livePos?.lon ?? -66;
                  const lat = livePos?.lat ?? 36;
                  // orthographic={lon},{lat},{zoom}. ~3500 puts the
                  // whole western Atlantic in view with the GS visible.
                  return `https://earth.nullschool.net/#current/ocean/surface/currents/orthographic=${lon.toFixed(2)},${lat.toFixed(2)},3500`;
                })()}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-block px-2 py-1 bg-amber-700 hover:bg-amber-600 text-amber-100 rounded font-medium"
              >
                Open in earth.nullschool ↗
              </a>
            </div>
          )}
          {(() => {
            const list = availableHours[windModel];
            if (list.length === 0) {
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
            const idx = list.indexOf(windHours);
            // If the current slider hour isn't in this model's cache, snap
            // to the nearest one as we render.
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
                    +{effectiveHours} h forecast
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
          {windGrid && (
            <div className="text-xs text-slate-400 leading-tight">
              <div>Showing: <span className="text-slate-200 font-mono">{windGrid.model.toUpperCase()}</span></div>
              <div>Run: <span className="text-slate-200 font-mono">{new Date(windGrid.runAt * 1000).toISOString().slice(0, 16).replace('T', ' ')}Z</span></div>
              <div>Valid: <span className="text-slate-200 font-mono">{new Date(windGrid.validAt * 1000).toISOString().slice(0, 16).replace('T', ' ')}Z</span> (+{windGrid.forecastHour}h)</div>
            </div>
          )}
          {windStatus && (
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
                  if (livePos)
                    setStart({ lat: livePos.lat, lon: livePos.lon });
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
        <PlanControls start={start} end={end} onPlan={onPlan} loading={loading} />
        {error && <div className="text-rose-400 text-xs">{error}</div>}
        {route && (
          <div className="text-xs text-slate-300">
            ETA: {new Date(route.end * 1000).toISOString()}<br />
            Distance: {(route.distance / 1852).toFixed(0)} NM<br />
            Model: {route.model}{route.incomplete ? ` (incomplete: ${route.reason})` : ''}
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
  const fmtCoord = (deg: number, axis: 'lat' | 'lon'): string => {
    const hemi = deg >= 0 ? (axis === 'lat' ? 'N' : 'E') : axis === 'lat' ? 'S' : 'W';
    const abs = Math.abs(deg);
    const d = Math.floor(abs);
    const m = (abs - d) * 60;
    return `${d}° ${m.toFixed(3)}' ${hemi}`;
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
        SOG: <span className="text-slate-200 font-mono">{sogKn !== null ? `${sogKn.toFixed(1)} kn` : '—'}</span>
      </div>
      <div className="text-slate-400">
        COG: <span className="text-slate-200 font-mono">{cogDeg !== null ? `${cogDeg.toFixed(0)}° T` : '—'}</span>
      </div>
      <div className="text-slate-400">
        HDG: <span className="text-slate-200 font-mono">{hdgDeg !== null ? `${hdgDeg.toFixed(0)}° T` : '—'}</span>
      </div>
    </div>
  );
}
