'use client';
import { useCallback, useEffect, useState } from 'react';
import { greatCircleNm } from '../../lib/geo';
import RouteBuilder from './RouteBuilder';

interface Waypoint {
  id: string;
  name: string;
  lat: number;
  lon: number;
  notes?: string;
  createdAt: string;
}

interface Route {
  id: string;
  name: string;
  waypointIds: string[];
  notes?: string;
  createdAt: string;
  updatedAt: string;
}

function totalDistanceNm(route: Route, wpMap: Map<string, Waypoint>): number {
  let total = 0;
  for (let i = 0; i < route.waypointIds.length - 1; i++) {
    const a = wpMap.get(route.waypointIds[i]!);
    const b = wpMap.get(route.waypointIds[i + 1]!);
    if (a && b) total += greatCircleNm(a, b);
  }
  return total;
}

export default function RoutesPage() {
  const [routes, setRoutes] = useState<Route[]>([]);
  const [waypoints, setWaypoints] = useState<Waypoint[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Builder state: null = hidden, 'new' = new route, string id = editing that route
  const [builderMode, setBuilderMode] = useState<'new' | string | null>(null);

  // Plan result messages keyed by route id
  const [planMessages, setPlanMessages] = useState<Record<string, string>>({});
  const [planBusy, setPlanBusy] = useState<Record<string, boolean>>({});

  const wpMap = new Map(waypoints.map((w) => [w.id, w]));

  const reloadRoutes = useCallback(async () => {
    try {
      const r = await fetch('/api/routes', { cache: 'no-store' });
      const j = await r.json();
      if (!j.ok) throw new Error(j.error?.message ?? 'load failed');
      setRoutes(j.routes);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, []);

  const reloadWaypoints = useCallback(async () => {
    try {
      const r = await fetch('/api/waypoints', { cache: 'no-store' });
      const j = await r.json();
      if (!j.ok) throw new Error(j.error?.message ?? 'load waypoints failed');
      setWaypoints(j.waypoints);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, []);

  const reload = useCallback(async () => {
    setLoading(true);
    await Promise.all([reloadRoutes(), reloadWaypoints()]);
    setLoading(false);
  }, [reloadRoutes, reloadWaypoints]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const handleDelete = async (id: string, name: string): Promise<void> => {
    if (!window.confirm(`Delete route "${name}"?`)) return;
    setError(null);
    try {
      const res = await fetch(`/api/routes/${id}`, { method: 'DELETE' });
      const j = await res.json();
      if (!j.ok) throw new Error(j.error?.message ?? 'delete failed');
      await reloadRoutes();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const handlePlan = async (route: Route): Promise<void> => {
    setError(null);
    setPlanBusy((prev) => ({ ...prev, [route.id]: true }));
    setPlanMessages((prev) => ({ ...prev, [route.id]: '' }));
    try {
      const res = await fetch(`/api/routes/${route.id}/plan`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        // Motor options (options.motor, options.motorSpeed) can be passed here later
        // when a motor-mode UI is added. For now use router defaults.
        body: JSON.stringify({}),
      });
      const j = (await res.json()) as {
        ok: boolean;
        route?: unknown;
        error?: { message?: string };
      };
      if (!j.ok) {
        const msg = j.error?.message ?? 'plan failed';
        setPlanMessages((prev) => ({ ...prev, [route.id]: `Error: ${msg}` }));
        return;
      }
      // /api/routes/[id]/plan proxies to /api/route/plan which returns
      // { ok: true, route: <plan object> } — no persisted plan id is issued.
      // We surface a summary message here. A chart-based route builder
      // (with navigation to /chart?plan=<id>) is future work.
      const plan = j.route as Record<string, unknown> | undefined;
      if (plan) {
        const legs = Array.isArray(plan.legs) ? (plan.legs as unknown[]).length : '?';
        const etaTs =
          typeof plan.end === 'number'
            ? new Date((plan.end as number) * 1000).toUTCString().replace(' GMT', 'Z')
            : null;
        const etaPart = etaTs ? `, ETA ${etaTs}` : '';
        setPlanMessages((prev) => ({
          ...prev,
          [route.id]: `Planned — ${legs} leg${legs === 1 ? '' : 's'}${etaPart}`,
        }));
      } else {
        setPlanMessages((prev) => ({ ...prev, [route.id]: 'Planned' }));
      }
    } catch (e) {
      setPlanMessages((prev) => ({
        ...prev,
        [route.id]: `Error: ${e instanceof Error ? e.message : String(e)}`,
      }));
    } finally {
      setPlanBusy((prev) => ({ ...prev, [route.id]: false }));
    }
  };

  const editingRoute =
    builderMode && builderMode !== 'new' ? routes.find((r) => r.id === builderMode) : undefined;

  const handleBuilderSaved = async (): Promise<void> => {
    setBuilderMode(null);
    await reload();
  };

  const handleWaypointCreated = (wp: { id: string; name: string; lat: number; lon: number }) => {
    setWaypoints((prev) => [
      ...prev,
      { id: wp.id, name: wp.name, lat: wp.lat, lon: wp.lon, createdAt: new Date().toISOString() },
    ]);
  };

  return (
    <main className="p-6 space-y-6">
      <h1 className="text-2xl font-semibold">Routes</h1>

      {error && <p className="text-rose-400 text-sm">{error}</p>}

      {builderMode !== null ? (
        <RouteBuilder
          initial={
            editingRoute
              ? {
                  id: editingRoute.id,
                  name: editingRoute.name,
                  waypointIds: editingRoute.waypointIds,
                  notes: editingRoute.notes,
                }
              : undefined
          }
          allWaypoints={waypoints}
          onSaved={() => void handleBuilderSaved()}
          onCancel={() => setBuilderMode(null)}
          onWaypointCreated={handleWaypointCreated}
        />
      ) : (
        <button
          onClick={() => setBuilderMode('new')}
          className="px-3 py-1 bg-amber-600 text-slate-900 rounded font-medium"
        >
          + New route
        </button>
      )}

      <section className="space-y-2">
        <h2 className="text-base font-semibold">Saved routes</h2>
        {loading && <p className="text-slate-500 text-sm">Loading…</p>}
        {!loading && routes.length === 0 && (
          <p className="text-slate-500 text-sm">No routes yet.</p>
        )}
        {!loading && routes.length > 0 && (
          <table className="w-full text-sm border-collapse">
            <thead>
              <tr className="text-left text-slate-400 border-b border-slate-800">
                <th className="p-2">Name</th>
                <th className="p-2">Waypoints</th>
                <th className="p-2">Distance</th>
                <th className="p-2">Notes</th>
                <th className="p-2 text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {routes.map((route) => {
                const dist = totalDistanceNm(route, wpMap);
                const planMsg = planMessages[route.id] ?? '';
                const isBusy = planBusy[route.id] ?? false;
                return (
                  <tr key={route.id} className="border-b border-slate-900">
                    <td className="p-2 font-mono">{route.name}</td>
                    <td className="p-2 text-slate-400">{route.waypointIds.length}</td>
                    <td className="p-2 font-mono">
                      {route.waypointIds.length >= 2 ? (
                        <>
                          {dist.toFixed(1)} <span className="text-slate-500">NM</span>
                        </>
                      ) : (
                        <span className="text-slate-600">—</span>
                      )}
                    </td>
                    <td className="p-2 text-slate-300">{route.notes ?? ''}</td>
                    <td className="p-2 text-right space-x-1">
                      {planMsg && (
                        <span
                          className={`text-xs mr-2 ${planMsg.startsWith('Error:') ? 'text-rose-400' : 'text-emerald-400'}`}
                        >
                          {planMsg}
                        </span>
                      )}
                      <button
                        onClick={() => void handlePlan(route)}
                        disabled={isBusy || builderMode !== null || route.waypointIds.length < 2}
                        title={
                          route.waypointIds.length < 2 ? 'Needs at least 2 waypoints' : 'Plan route'
                        }
                        className="px-2 py-1 text-xs bg-sky-800 hover:bg-sky-700 text-sky-100 rounded disabled:opacity-50"
                      >
                        {isBusy ? 'Planning…' : 'Plan'}
                      </button>
                      <button
                        onClick={() => setBuilderMode(route.id)}
                        disabled={builderMode !== null}
                        className="px-2 py-1 text-xs bg-slate-700 hover:bg-slate-600 rounded disabled:opacity-50"
                      >
                        Edit
                      </button>
                      <button
                        onClick={() => void handleDelete(route.id, route.name)}
                        disabled={builderMode !== null}
                        className="px-2 py-1 text-xs bg-red-900 hover:bg-red-800 text-red-100 rounded disabled:opacity-50"
                      >
                        Delete
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </section>
    </main>
  );
}
