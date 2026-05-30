'use client';
import { useState, useRef, useEffect } from 'react';
import type { Route } from '@g5000/routing';
import { PlanControls, type PlanParams } from '../../components/PlanControls';
import type { RouteColorMode } from '../../components/RoutePolyline';
import type { TzMode } from '../../lib/tz';
import { reorder } from '../routes/reorder';
import { type SavedRouteLite } from '../../lib/plan-via';
import { removeAt, insertAt, setStart, setEnd, startOf, endOf, viaOf } from '../../lib/route-plan';

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
  /** Unified ordered waypoint IDs [start, ...via, end], owned by the parent. */
  ids: string[];
  onIdsChange: (ids: string[]) => void;
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
  const { waypoints } = props;
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [summary, setSummary] = useState<string | null>(null);
  const [mode, setMode] = useState<'waypoints' | 'route'>('waypoints');
  const [routes, setRoutes] = useState<SavedRouteLite[]>([]);
  const [routeId, setRouteId] = useState<string>('');
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    void fetch('/api/routes')
      .then((r) => r.json())
      .then((j) => {
        if (j?.ok && Array.isArray(j.routes)) setRoutes(j.routes as SavedRouteLite[]);
      })
      .catch(() => {});
  }, []);

  const wpById = new Map(waypoints.map((w) => [w.id, w]));
  const ids = props.ids;
  const startId = startOf(ids) ?? '';
  const endId = endOf(ids) ?? '';
  const viaIds = viaOf(ids);

  const resolve = (id: string) => {
    const w = wpById.get(id);
    return w ? { lat: w.lat, lon: w.lon } : undefined;
  };
  const start = resolve(startId);
  const end = resolve(endId);
  const via = viaIds.map(resolve).filter((p): p is { lat: number; lon: number } => !!p);

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
              via: params.via,
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
          <div className="flex gap-2 text-xs">
            {(['waypoints', 'route'] as const).map((m) => (
              <button
                key={m}
                onClick={() => setMode(m)}
                className={`px-2 py-1 rounded ${mode === m ? 'bg-emerald-700' : 'bg-slate-800'}`}
              >
                {m === 'waypoints' ? 'Pick waypoints' : 'Saved route'}
              </button>
            ))}
          </div>

          {mode === 'route' ? (
            <label className="block text-sm">
              Route
              <select
                value={routeId}
                onChange={(e) => {
                  setRouteId(e.target.value);
                  const r = routes.find((x) => x.id === e.target.value);
                  if (r) props.onIdsChange(r.waypointIds.filter((id) => wpById.has(id)));
                }}
                className={selectClass}
              >
                <option value="">— select route —</option>
                {routes.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.name}
                  </option>
                ))}
              </select>
            </label>
          ) : (
            <>
              <WaypointSelect
                label="Start"
                value={startId}
                waypoints={waypoints}
                disabledId={endId}
                onChange={(id) => props.onIdsChange(setStart(ids, id))}
              />
              {viaIds.map((id, i) => (
                <div key={`${id}-${i}`} className="flex items-end gap-1">
                  <div className="flex-1">
                    <WaypointSelect
                      label={`Via ${i + 1}`}
                      value={id}
                      waypoints={waypoints}
                      disabledId=""
                      onChange={(v) => props.onIdsChange(ids.map((x, j) => (j === i + 1 ? v : x)))}
                    />
                  </div>
                  <button
                    onClick={() => props.onIdsChange(i > 0 ? reorder(ids, i + 1, i) : ids)}
                    className="px-2 py-1 text-xs bg-slate-800 rounded"
                    title="Move up"
                  >
                    ↑
                  </button>
                  <button
                    onClick={() =>
                      props.onIdsChange(i + 1 < viaIds.length ? reorder(ids, i + 1, i + 2) : ids)
                    }
                    className="px-2 py-1 text-xs bg-slate-800 rounded"
                    title="Move down"
                  >
                    ↓
                  </button>
                  <button
                    onClick={() => props.onIdsChange(removeAt(ids, i + 1))}
                    className="px-2 py-1 text-xs bg-slate-800 rounded"
                    title="Remove"
                  >
                    ✕
                  </button>
                </div>
              ))}
              <button
                onClick={() => {
                  const candidate =
                    waypoints.find((w) => !ids.includes(w.id))?.id ?? waypoints[0]?.id;
                  if (candidate)
                    props.onIdsChange(insertAt(ids, Math.max(1, ids.length - 1), candidate));
                }}
                disabled={waypoints.length === 0 || waypoints.every((w) => ids.includes(w.id))}
                className="text-xs px-2 py-1 bg-slate-800 rounded disabled:opacity-40"
              >
                + add via waypoint
              </button>
              <WaypointSelect
                label="End"
                value={endId}
                waypoints={waypoints}
                disabledId={startId}
                onChange={(id) => props.onIdsChange(setEnd(ids, id))}
              />
            </>
          )}
          <PlanControls
            start={start}
            end={end}
            via={via}
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
