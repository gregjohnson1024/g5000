'use client';
import { useState } from 'react';
import type { Route } from '@g5000/routing';
import { PlanControls, type PlanRequest } from '../../components/PlanControls';
import type { TzMode } from '../../lib/tz';

interface Wp {
  id: string;
  name: string;
  lat: number;
  lon: number;
}

const selectClass = 'bg-slate-900 border border-slate-700 rounded px-2 py-1 w-full mt-0.5 text-sm';

/**
 * Chart-side route planner. Pick a Start and End waypoint, then PlanControls
 * (departure / wind model / currents / motor) POSTs to /api/route/plan. The
 * resulting Route is handed back via onRouted, which the chart draws and
 * animates. Start/End come from saved waypoints — drop them with the pin
 * tool (top-right) — rather than ad-hoc cursor clicks.
 */
export function RoutePlanPanel(props: {
  waypoints: Wp[];
  tz: TzMode;
  hasRoute: boolean;
  onRouted: (route: Route) => void;
  onClear: () => void;
}) {
  const { waypoints } = props;
  const [startId, setStartId] = useState('');
  const [endId, setEndId] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [summary, setSummary] = useState<string | null>(null);

  const start = waypoints.find((w) => w.id === startId);
  const end = waypoints.find((w) => w.id === endId);

  const onPlan = async (req: PlanRequest): Promise<void> => {
    setLoading(true);
    setError(null);
    setSummary(null);
    try {
      const res = await fetch('/api/route/plan', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          start: req.start,
          end: req.end,
          departure: req.departure,
          model: req.model,
          useCurrents: req.useCurrents,
          options: req.options,
        }),
      });
      const j = (await res.json()) as {
        ok: boolean;
        route?: Route;
        error?: { message?: string };
      };
      if (!j.ok || !j.route) {
        setError(j.error?.message ?? 'plan failed');
        return;
      }
      const r = j.route;
      const hrs = (r.end - r.start) / 3600;
      const nm = r.distance / 1852;
      setSummary(
        `${r.incomplete ? 'Incomplete' : 'Reached'} — ${r.legs.length} legs, ${nm.toFixed(0)} NM, ${hrs.toFixed(1)} h` +
          (r.incomplete && r.reason ? ` (${r.reason})` : ''),
      );
      props.onRouted(r);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  };

  return (
    <section className="space-y-2 bg-slate-900/60 border border-slate-800 rounded p-2">
      <h2 className="text-sm font-semibold">Route planner</h2>
      {waypoints.length < 2 ? (
        <p className="text-xs text-slate-400">
          Drop at least two waypoints (the pin button, top-right of the map) to plan a route between
          them.
        </p>
      ) : (
        <>
          <label className="block text-sm">
            Start
            <select
              value={startId}
              onChange={(e) => setStartId(e.target.value)}
              className={selectClass}
            >
              <option value="">— select waypoint —</option>
              {waypoints.map((w) => (
                <option key={w.id} value={w.id} disabled={w.id === endId}>
                  {w.name}
                </option>
              ))}
            </select>
          </label>
          <label className="block text-sm">
            End
            <select
              value={endId}
              onChange={(e) => setEndId(e.target.value)}
              className={selectClass}
            >
              <option value="">— select waypoint —</option>
              {waypoints.map((w) => (
                <option key={w.id} value={w.id} disabled={w.id === startId}>
                  {w.name}
                </option>
              ))}
            </select>
          </label>
          <PlanControls
            start={start ? { lat: start.lat, lon: start.lon } : undefined}
            end={end ? { lat: end.lat, lon: end.lon } : undefined}
            onPlan={onPlan}
            loading={loading}
            tz={props.tz}
          />
          {summary && <p className="text-xs text-emerald-400">{summary}</p>}
          {error && <p className="text-xs text-rose-400">Error: {error}</p>}
          {props.hasRoute && (
            <button
              onClick={props.onClear}
              className="w-full px-3 py-1 text-sm bg-slate-700 hover:bg-slate-600 rounded"
            >
              Clear route
            </button>
          )}
        </>
      )}
    </section>
  );
}
