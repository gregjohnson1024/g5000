'use client';
import { useState } from 'react';
import type { Route } from '@g5000/routing';
import { PlanControls, type PlanParams } from '../../components/PlanControls';
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
  onRouted: (routes: Partial<Record<'GFS' | 'ECMWF', Route>>) => void;
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

  const onPlan = async (params: PlanParams): Promise<void> => {
    setLoading(true);
    setError(null);
    setSummary(null);
    // Drop the previous route the moment planning starts — otherwise a stale
    // line lingers on the chart for the seconds the plan takes to compute.
    props.onClear();
    const results: Partial<Record<'GFS' | 'ECMWF', Route>> = {};
    const errs: string[] = [];
    await Promise.all(
      params.models.map(async (model) => {
        try {
          const res = await fetch('/api/route/plan', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({
              start: params.start,
              end: params.end,
              departure: params.departure,
              model,
              useCurrents: params.useCurrents,
              options: params.options,
            }),
          });
          const j = (await res.json()) as {
            ok: boolean;
            route?: Route;
            error?: { message?: string };
          };
          if (!j.ok || !j.route) errs.push(`${model}: ${j.error?.message ?? 'plan failed'}`);
          else results[model] = j.route;
        } catch (e) {
          errs.push(`${model}: ${e instanceof Error ? e.message : String(e)}`);
        }
      }),
    );
    setLoading(false);
    if (errs.length) setError(errs.join(' · '));
    if (Object.keys(results).length) {
      const parts = (Object.entries(results) as Array<['GFS' | 'ECMWF', Route]>).map(
        ([m, r]) =>
          `${m}: ${(r.distance / 1852).toFixed(0)} NM / ${((r.end - r.start) / 3600).toFixed(1)} h${r.incomplete ? ' (incomplete)' : ''}`,
      );
      setSummary(parts.join(' · '));
      props.onRouted(results);
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
