'use client';
import { useState, useRef } from 'react';
import type { Route } from '@g5000/routing';
import { PlanControls, type PlanParams } from '../../components/PlanControls';
import type { RouteColorMode } from '../../components/RoutePolyline';
import type { TzMode } from '../../lib/tz';

function fmtRouteDuration(secs: number): string {
  const totalMin = Math.round(secs / 60);
  const d = Math.floor(totalMin / (24 * 60));
  const h = Math.floor((totalMin % (24 * 60)) / 60);
  const m = totalMin % 60;
  const hh = String(h).padStart(2, '0');
  const mm = String(m).padStart(2, '0');
  return d > 0 ? `${d}d ${hh}:${mm}` : `${hh}:${mm}`;
}

const INCOMPLETE_REASON: Record<string, string> = {
  exceeded_max_hours: 'exceeded time',
  no_wind: 'no wind',
  land_blocked: 'land block',
};

interface Wp {
  id: string;
  name: string;
  lat: number;
  lon: number;
}

const selectClass = 'bg-slate-900 border border-slate-700 rounded px-2 py-1 w-full mt-0.5 text-sm';

/** Start/End waypoint picker. `disabledId` greys out the waypoint already
 *  chosen for the other endpoint so the same one can't be both. */
function WaypointSelect(props: {
  label: string;
  value: string;
  waypoints: Wp[];
  disabledId: string;
  onChange: (id: string) => void;
}) {
  return (
    <label className="block text-sm">
      {props.label}
      <select
        value={props.value}
        onChange={(e) => props.onChange(e.target.value)}
        className={selectClass}
      >
        <option value="">— select waypoint —</option>
        {props.waypoints.map((w) => (
          <option key={w.id} value={w.id} disabled={w.id === props.disabledId}>
            {w.name}
          </option>
        ))}
      </select>
    </label>
  );
}

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
  /** Selected Start/End waypoint ids, lifted to the parent so it can badge
   *  the start (green) and end (red) marks on the chart. */
  startId: string;
  endId: string;
  onStartId: (id: string) => void;
  onEndId: (id: string) => void;
  colorMode: RouteColorMode;
  onColorMode: (m: RouteColorMode) => void;
  colorTwaDisabled?: boolean;
  onRouted: (routes: Partial<Record<'GFS' | 'ECMWF', Route>>) => void;
  onClear: () => void;
  showIsochrones: boolean;
  onShowIsochrones: (v: boolean) => void;
  showRouteWind: boolean;
  onShowRouteWind: (v: boolean) => void;
}) {
  const { waypoints, startId, endId } = props;
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [summary, setSummary] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const start = waypoints.find((w) => w.id === startId);
  const end = waypoints.find((w) => w.id === endId);

  const onPlan = async (params: PlanParams): Promise<void> => {
    abortRef.current?.abort();
    const ctrl = new AbortController();
    abortRef.current = ctrl;
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
            signal: ctrl.signal,
          });
          const j = (await res.json()) as {
            ok: boolean;
            route?: Route;
            error?: { message?: string };
          };
          if (!j.ok || !j.route) errs.push(`${model}: ${j.error?.message ?? 'plan failed'}`);
          else results[model] = j.route;
        } catch (e) {
          if (e instanceof Error && e.name === 'AbortError') return;
          errs.push(`${model}: ${e instanceof Error ? e.message : String(e)}`);
        }
      }),
    );
    if (ctrl.signal.aborted) {
      setLoading(false);
      return;
    }
    setLoading(false);
    if (errs.length) setError(errs.join(' · '));
    if (Object.keys(results).length) {
      const parts = (Object.entries(results) as Array<['GFS' | 'ECMWF', Route]>).map(
        ([m, r]) =>
          `${m}: ${(r.distance / 1852).toFixed(0)} NM / ${fmtRouteDuration(r.end - r.start)}${r.incomplete ? ` (incomplete — ${INCOMPLETE_REASON[r.reason ?? ''] ?? 'unknown reason'})` : ''}`,
      );
      setSummary(parts.join(' · '));
      props.onRouted(results);
    }
  };

  const onCancel = (): void => {
    abortRef.current?.abort();
    abortRef.current = null;
    setLoading(false);
    setError(null);
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
          <WaypointSelect
            label="Start"
            value={startId}
            waypoints={waypoints}
            disabledId={endId}
            onChange={props.onStartId}
          />
          <WaypointSelect
            label="End"
            value={endId}
            waypoints={waypoints}
            disabledId={startId}
            onChange={props.onEndId}
          />
          <PlanControls
            start={start ? { lat: start.lat, lon: start.lon } : undefined}
            end={end ? { lat: end.lat, lon: end.lon } : undefined}
            onPlan={onPlan}
            loading={loading}
            tz={props.tz}
            colorMode={props.colorMode}
            onColorMode={props.onColorMode}
            colorTwaDisabled={props.colorTwaDisabled}
            showIsochrones={props.showIsochrones}
            onShowIsochrones={props.onShowIsochrones}
            showRouteWind={props.showRouteWind}
            onShowRouteWind={props.onShowRouteWind}
          />
          {loading && (
            <button
              onClick={onCancel}
              className="w-full px-3 py-1 text-sm bg-slate-700 hover:bg-slate-600 rounded"
            >
              Cancel planning
            </button>
          )}
          {summary && <p className="text-xs text-emerald-400">{summary}</p>}
          {error && <p className="text-xs text-rose-400">Error: {error}</p>}
          {props.hasRoute && (
            <button
              onClick={() => {
                setError(null);
                setSummary(null);
                props.onClear();
              }}
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
