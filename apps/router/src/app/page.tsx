'use client';
import { useRef, useState } from 'react';
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
  const [windOpacity, setWindOpacity] = useState(0.85);
  const [windRefreshKey, setWindRefreshKey] = useState(0);
  const [windGrid, setWindGrid] = useState<WindGrid | null>(null);
  const [windStatus, setWindStatus] = useState<string | null>(null);
  const [windBusy, setWindBusy] = useState(false);
  const [cogExtOn, setCogExtOn] = useState(true);
  const [start, setStart] = useState<Pos | undefined>();
  const [end, setEnd] = useState<Pos | undefined>();
  const [loading, setLoading] = useState(false);
  const [route, setRoute] = useState<Route | undefined>();
  const [error, setError] = useState<string | undefined>();
  const [savedMsg, setSavedMsg] = useState<string | undefined>();
  const [saving, setSaving] = useState(false);

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
          refreshKey={windRefreshKey}
          onLoaded={({ grid, identical, error }) => {
            setWindBusy(false);
            if (error) {
              setWindStatus(`Error: ${error}`);
            } else if (identical) {
              setWindStatus('No change — already showing this run');
            } else if (grid) {
              setWindGrid(grid);
              setWindStatus('Updated');
            }
            setTimeout(() => setWindStatus(null), 4000);
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
                <option value="gfs">GFS (NOAA)</option>
                <option value="ecmwf">ECMWF</option>
              </select>
            </label>
          </div>
          <label className="block text-xs text-slate-400">
            +{windHours} h forecast
            <input
              type="range"
              min={0}
              max={120}
              step={3}
              value={windHours}
              onChange={(e) => setWindHours(Number(e.target.value))}
              className="block w-full"
            />
          </label>
          <label className="block text-xs text-slate-400">
            Opacity {Math.round(windOpacity * 100)}%
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
          <button
            type="button"
            onClick={() => {
              setWindBusy(true);
              setWindStatus('Fetching…');
              setWindRefreshKey((k) => k + 1);
            }}
            disabled={windBusy || livePos === null}
            className="w-full px-2 py-1 bg-amber-600 hover:bg-amber-500 disabled:bg-slate-700 text-slate-900 disabled:text-slate-400 text-sm rounded"
          >
            {windBusy ? 'Fetching…' : 'Get forecast'}
          </button>
          {windGrid && (
            <div className="text-xs text-slate-400 leading-tight">
              <div>Model: <span className="text-slate-200 font-mono">{windGrid.model.toUpperCase()}</span></div>
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
