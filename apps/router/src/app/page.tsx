'use client';
import { useRef, useState } from 'react';
import maplibregl from 'maplibre-gl';
import { Map } from '../components/Map';
import { StatusBadge } from '../components/StatusBadge';
import { PlanControls, type PlanRequest } from '../components/PlanControls';
import { attachRoute } from '../components/RoutePolyline';
import type { Route } from '@g5000/routing';

type Pos = { lat: number; lon: number };

export default function HomePage() {
  const mapRef = useRef<maplibregl.Map | null>(null);
  const [start, setStart] = useState<Pos | undefined>();
  const [end, setEnd] = useState<Pos | undefined>();
  const [loading, setLoading] = useState(false);
  const [route, setRoute] = useState<Route | undefined>();
  const [error, setError] = useState<string | undefined>();

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
  return (
    <main className="grid grid-cols-[1fr_360px] h-screen">
      <Map
        center={{ lat: 35, lon: -70 }}
        zoom={4}
        onClick={onMapClick}
        onLoad={(m) => { mapRef.current = m; }}
      />
      <aside className="p-4 border-l border-slate-800 space-y-4 overflow-y-auto">
        <StatusBadge />
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
      </aside>
    </main>
  );
}
