'use client';
import { useRef, useState } from 'react';
import maplibregl from 'maplibre-gl';
import { Map } from '../components/Map';
import { StatusBadge } from '../components/StatusBadge';
import { PlanControls, type PlanRequest } from '../components/PlanControls';
import { attachRoute } from '../components/RoutePolyline';
import { RouteTimeline } from '../components/RouteTimeline';
import { LiveBoatMarker, type LivePos } from '../components/LiveBoatMarker';
import type { Route } from '@g5000/routing';

type Pos = { lat: number; lon: number };

export default function HomePage() {
  const mapRef = useRef<maplibregl.Map | null>(null);
  const [mapInstance, setMapInstance] = useState<maplibregl.Map | null>(null);
  const [livePos, setLivePos] = useState<LivePos | null>(null);
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
  const cogDeg = typeof p.cog === 'number' ? ((p.cog * RAD_TO_DEG) % 360 + 360) % 360 : null;
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
    </div>
  );
}
