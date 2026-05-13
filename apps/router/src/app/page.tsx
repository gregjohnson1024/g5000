'use client';
import { useEffect, useRef, useState } from 'react';
import maplibregl from 'maplibre-gl';
import { Map } from '../components/Map';
import { StatusBadge } from '../components/StatusBadge';
import { PlanControls, type PlanRequest } from '../components/PlanControls';
import { attachRoute } from '../components/RoutePolyline';
import { RouteTimeline } from '../components/RouteTimeline';
import { LiveBoatMarker, type LivePos } from '../components/LiveBoatMarker';
import { DriftArrow, computeDrift } from '../components/DriftArrow';
import { WindOverlay, type WindGrid, type WindModel } from '../components/WindOverlay';
import { CogExtension } from '../components/CogExtension';
import type { Route } from '@g5000/routing';

type Pos = { lat: number; lon: number };

export default function HomePage() {
  const mapRef = useRef<maplibregl.Map | null>(null);
  const [mapInstance, setMapInstance] = useState<maplibregl.Map | null>(null);
  const [livePos, setLivePos] = useState<LivePos | null>(null);
  const [windHours, setWindHours] = useState(0);
  const [windModel, setWindModel] = useState<WindModel>('gfs');
  const [windOn, setWindOn] = useState(true);
  const [windOpacity, setWindOpacity] = useState(0.5);
  const [showFill, setShowFill] = useState(true);
  const [showBarbs, setShowBarbs] = useState(true);
  const [showIsobars, setShowIsobars] = useState(true);
  // Bumped automatically whenever the user moves the timeline / model so the
  // chart re-reads from the cache. Fetching itself happens on /forecast.
  const [windRefreshKey, setWindRefreshKey] = useState(1);
  const [windGrid, setWindGrid] = useState<WindGrid | null>(null);
  const [windStatus, setWindStatus] = useState<string | null>(null);
  const [availableHours, setAvailableHours] = useState<{ gfs: number[]; ecmwf: number[] }>({
    gfs: [],
    ecmwf: [],
  });
  const [cogExtOn, setCogExtOn] = useState(true);
  const [start, setStart] = useState<Pos | undefined>();
  const [end, setEnd] = useState<Pos | undefined>();
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
      if (mapRef.current) attachRoute(mapRef.current, 'route-gfs', j.route);
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
        <DriftArrow map={mapInstance} p={livePos} />
        <CogExtension map={mapInstance} p={livePos} hidden={!cogExtOn} />
        <WindOverlay
          map={mapInstance}
          centerLat={livePos?.lat ?? null}
          centerLon={livePos?.lon ?? null}
          model={windModel}
          hours={windHours}
          hidden={!windOn}
          opacity={windOpacity}
          showFill={showFill}
          showBarbs={showBarbs}
          showIsobars={showIsobars}
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
            className="absolute top-3 left-3 px-3 py-1.5 bg-slate-900/85 hover:bg-slate-800 border border-slate-700 text-slate-200 text-sm rounded shadow"
            title="Pan map to boat's current position"
          >
            ⊕ Center on boat
          </button>
        )}
      </div>
      <aside className="p-4 border-l border-slate-800 space-y-4 overflow-y-auto">
        <StatusBadge />
        <LiveValues p={livePos} />
        <div className="space-y-2 bg-slate-900/60 border border-slate-800 rounded p-2">
          <div className="flex items-center justify-between text-sm">
            <span className="text-slate-400 font-medium">Wind</span>
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
                value={windModel}
                onChange={(e) => setWindModel(e.target.value as WindModel)}
                className="bg-slate-900 border border-slate-700 rounded px-1 py-0.5 text-slate-200"
              >
                <option value="gfs" disabled={availableHours.gfs.length === 0}>
                  GFS{availableHours.gfs.length ? '' : ' (no cache)'}
                </option>
                <option value="ecmwf" disabled={availableHours.ecmwf.length === 0}>
                  ECMWF{availableHours.ecmwf.length ? '' : ' (no cache)'}
                </option>
              </select>
            </label>
          </div>
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
            return (
              <label className="block text-xs text-slate-400">
                +{windHours} h forecast
                <input
                  type="range"
                  min={list[0]}
                  max={list[list.length - 1]}
                  step={1}
                  value={windHours}
                  onChange={(e) => {
                    // Snap the slider to the nearest cached hour.
                    const v = Number(e.target.value);
                    const nearest = list.reduce(
                      (best, h) => (Math.abs(h - v) < Math.abs(best - v) ? h : best),
                      list[0]!,
                    );
                    setWindHours(nearest);
                  }}
                  className="block w-full"
                />
                <span className="font-mono text-slate-500">
                  cached: {list.map((h) => `+${h}h`).join(', ')}
                </span>
              </label>
            );
          })()}
          <label className="block text-xs text-slate-400">
            Fill opacity {Math.round(windOpacity * 100)}%
            <input
              type="range"
              min={0}
              max={1}
              step={0.05}
              value={windOpacity}
              onChange={(e) => setWindOpacity(Number(e.target.value))}
              className="block w-full"
            />
          </label>
          <div className="flex gap-3 text-xs flex-wrap">
            <label className="flex items-center gap-1">
              <input
                type="checkbox"
                checked={showFill}
                onChange={(e) => setShowFill(e.target.checked)}
              />
              <span className="text-slate-300">speed fill</span>
            </label>
            <label className="flex items-center gap-1">
              <input
                type="checkbox"
                checked={showBarbs}
                onChange={(e) => setShowBarbs(e.target.checked)}
              />
              <span className="text-slate-300">barbs</span>
            </label>
            <label className="flex items-center gap-1">
              <input
                type="checkbox"
                checked={showIsobars}
                onChange={(e) => setShowIsobars(e.target.checked)}
              />
              <span className="text-slate-300">isobars</span>
            </label>
          </div>
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
        </div>
        <div className="space-y-1 bg-slate-900/60 border border-slate-800 rounded p-2">
          <label className="flex items-center justify-between text-sm">
            <span className="text-slate-400">COG extension (120 min)</span>
            <input
              type="checkbox"
              checked={cogExtOn}
              onChange={(e) => setCogExtOn(e.target.checked)}
            />
          </label>
          <p className="text-xs text-slate-500">
            Dashed violet line ahead of the boat with 30/60/90/120 min ticks at the current SOG.
          </p>
        </div>
        <div className="text-xs text-slate-400 space-y-1">
          <div>Start: {start ? `${start.lat.toFixed(3)}, ${start.lon.toFixed(3)}` : '— click map'}</div>
          <div>End:   {end ? `${end.lat.toFixed(3)}, ${end.lon.toFixed(3)}` : '— click map'}</div>
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
  const drift = computeDrift(p.hdg, p.cog, p.sog);
  const driftKn = drift ? drift.magnitudeMps / 0.514444 : null;
  const driftBrgDeg = drift ? wrap360((drift.bearingRad * 180) / Math.PI) : null;
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
      <div className="text-cyan-300">
        Drift: <span className="font-mono">
          {driftKn !== null && driftBrgDeg !== null ? `${driftKn.toFixed(1)} kn @ ${driftBrgDeg.toFixed(0)}° T` : '—'}
        </span>
      </div>
    </div>
  );
}
