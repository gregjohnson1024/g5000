'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { fmtLatLonDmm } from '../../lib/format-coords';
import { formatDuration, fmtUtcMinute } from '../../lib/tz';

const M_PER_NM = 1852;
const PAGE_SIZE = 50;

type TripMode = 'sail' | 'motor' | 'mixed' | 'unknown';

interface Trip {
  id: number;
  startMs: number;
  endMs: number;
  startLat: number;
  startLon: number;
  endLat: number;
  endLon: number;
  distanceM: number;
  durationS: number;
  maxSogKn: number;
  avgSogKn: number;
  mode: TripMode;
  pointOfSail: Record<string, number> | null;
  stayKind: 'anchor' | 'unknown';
  moorageStartName: string | null;
  moorageEndName: string | null;
  notes: string | null;
  createdMs: number;
  /** Gap to the next chronological trip in seconds; null when unknown/open. */
  stayDurationS: number | null;
}

interface TripStats {
  totalTrips: number;
  totalNm: number;
  totalUnderwayS: number;
  longestTrip: { nm: number; durationS: number; startMs: number } | null;
  maxSogKn: number | null;
  nightsAtAnchor: number;
  hoursAtAnchor: number;
  hoursMoored: number;
}

interface CurrentSnapshot {
  state: 'moored' | 'underway';
  sinceMs: number;
  liveDistanceM: number;
  liveDurationS: number;
}

/** Persisted filter state; dates are UTC YYYY-MM-DD ('' = open-ended). */
interface FiltersState {
  from: string;
  to: string;
}

const FILTERS_KEY = 'trips:state';

const MODE_BADGE: Record<TripMode, string> = {
  sail: 'bg-emerald-800 text-emerald-100',
  motor: 'bg-amber-800 text-amber-100',
  mixed: 'bg-sky-800 text-sky-100',
  unknown: 'bg-slate-700 text-slate-300',
};

const POS_ORDER = ['upwind', 'reaching', 'downwind', 'not-sailing'] as const;
const POS_COLOR: Record<string, string> = {
  upwind: 'bg-sky-500',
  reaching: 'bg-emerald-500',
  downwind: 'bg-violet-500',
  'not-sailing': 'bg-slate-600',
};

/** Season default: Jan 1 of the current UTC year. */
function defaultFilters(): FiltersState {
  return { from: `${new Date().getUTCFullYear()}-01-01`, to: '' };
}

function fmtUtc(ms: number): { ymd: string; hm: string } {
  const iso = new Date(ms).toISOString();
  return { ymd: iso.slice(0, 10), hm: iso.slice(11, 16) };
}

/** Duration ladder with a seconds rung below formatDuration's minute floor. */
function fmtDurationS(seconds: number): string {
  if (seconds < 60) return `${Math.max(0, Math.round(seconds))}s`;
  return formatDuration(seconds);
}

function filterParams(filters: FiltersState): { from?: string; to?: string } {
  const out: { from?: string; to?: string } = {};
  if (filters.from) {
    const ms = Date.parse(`${filters.from}T00:00:00Z`);
    if (Number.isFinite(ms)) out.from = String(ms);
  }
  if (filters.to) {
    const ms = Date.parse(`${filters.to}T23:59:59.999Z`);
    if (Number.isFinite(ms)) out.to = String(ms);
  }
  return out;
}

export function TripsClientView() {
  const [filters, setFilters] = useState<FiltersState>(defaultFilters);
  const [filtersLoaded, setFiltersLoaded] = useState(false);
  const [stats, setStats] = useState<TripStats | null>(null);
  const [trips, setTrips] = useState<Trip[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [current, setCurrent] = useState<CurrentSnapshot | null>(null);

  // Restore persisted filters once, client-side only.
  useEffect(() => {
    try {
      const raw = localStorage.getItem(FILTERS_KEY);
      if (raw) {
        const saved = JSON.parse(raw) as Partial<FiltersState>;
        setFilters((f) => ({
          from: typeof saved.from === 'string' ? saved.from : f.from,
          to: typeof saved.to === 'string' ? saved.to : f.to,
        }));
      }
    } catch {
      /* corrupt / private mode — keep defaults */
    }
    setFiltersLoaded(true);
  }, []);

  const writeFilters = (next: FiltersState): void => {
    setFilters(next);
    try {
      localStorage.setItem(FILTERS_KEY, JSON.stringify(next));
    } catch {
      /* quota / private mode — ignore */
    }
  };

  const loadStats = useCallback(async (): Promise<void> => {
    const url = new URL('/api/trips/stats', window.location.origin);
    for (const [k, v] of Object.entries(filterParams(filters))) url.searchParams.set(k, v);
    const r = await fetch(url.toString(), { cache: 'no-store' });
    const j = (await r.json()) as { ok: boolean; stats?: TripStats };
    if (j.ok && j.stats) setStats(j.stats);
  }, [filters]);

  const loadTrips = useCallback(
    async (before?: number): Promise<void> => {
      setLoading(true);
      try {
        const url = new URL('/api/trips', window.location.origin);
        url.searchParams.set('limit', String(PAGE_SIZE));
        for (const [k, v] of Object.entries(filterParams(filters))) url.searchParams.set(k, v);
        if (before !== undefined) url.searchParams.set('before', String(before));
        const r = await fetch(url.toString(), { cache: 'no-store' });
        const j = (await r.json()) as { ok: boolean; trips?: Trip[]; error?: { message: string } };
        if (!j.ok || !j.trips) throw new Error(j.error?.message ?? 'load failed');
        const page = j.trips;
        setTrips((prev) => (before === undefined ? page : [...prev, ...page]));
        setHasMore(page.length === PAGE_SIZE);
        setErr(null);
      } catch (e) {
        setErr(e instanceof Error ? e.message : String(e));
      } finally {
        setLoading(false);
      }
    },
    [filters],
  );

  useEffect(() => {
    if (!filtersLoaded) return;
    void loadTrips();
    void loadStats();
  }, [filtersLoaded, loadTrips, loadStats]);

  // Live underway banner: poll the trip engine every 5 s.
  useEffect(() => {
    let stopped = false;
    async function poll() {
      try {
        const r = await fetch('/api/trips/current', { cache: 'no-store' });
        if (stopped) return;
        if (!r.ok) {
          setCurrent(null);
          return;
        }
        const j = (await r.json()) as { ok: boolean; snapshot?: CurrentSnapshot };
        setCurrent(j.ok && j.snapshot ? j.snapshot : null);
      } catch {
        /* transient */
      }
    }
    void poll();
    const t = setInterval(() => void poll(), 5_000);
    return () => {
      stopped = true;
      clearInterval(t);
    };
  }, []);

  const reloadAll = useCallback(async (): Promise<void> => {
    await Promise.all([loadTrips(), loadStats()]);
  }, [loadTrips, loadStats]);

  const patchTrip = async (
    id: number,
    patch: {
      mode?: TripMode;
      moorageStartName?: string | null;
      moorageEndName?: string | null;
      notes?: string | null;
    },
  ): Promise<void> => {
    const r = await fetch(`/api/trips/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(patch),
    });
    const j = (await r.json()) as { ok: boolean; trip?: Trip; error?: { message: string } };
    if (!j.ok || !j.trip) throw new Error(j.error?.message ?? 'save failed');
    const updated = j.trip;
    // The PATCH response has no stayDurationS (it's derived per page) — keep ours.
    setTrips((prev) =>
      prev.map((t) => (t.id === id ? { ...updated, stayDurationS: t.stayDurationS } : t)),
    );
    void loadStats();
  };

  const deleteTrip = async (id: number): Promise<void> => {
    if (!window.confirm('Delete this trip? This cannot be undone.')) return;
    const r = await fetch(`/api/trips/${id}`, { method: 'DELETE' });
    const j = (await r.json()) as { ok: boolean; error?: { message: string } };
    if (!j.ok) {
      setErr(j.error?.message ?? 'delete failed');
      return;
    }
    await reloadAll();
  };

  // Group by UTC start day, preserving the API's newest-first order.
  const grouped = useMemo(() => {
    const out: Array<{ ymd: string; rows: Trip[] }> = [];
    let cur: { ymd: string; rows: Trip[] } | null = null;
    for (const t of trips) {
      const ymd = fmtUtc(t.startMs).ymd;
      if (!cur || cur.ymd !== ymd) {
        cur = { ymd, rows: [] };
        out.push(cur);
      }
      cur.rows.push(t);
    }
    return out;
  }, [trips]);

  return (
    <main className="p-4 max-w-5xl mx-auto text-slate-100">
      <div className="flex items-baseline justify-between mb-4">
        <h1 className="text-2xl font-semibold">Trips</h1>
        <div className="text-xs text-slate-400 font-mono">UTC · {trips.length} loaded</div>
      </div>

      {current?.state === 'underway' && (
        <div className="mb-4 px-3 py-2 rounded border border-emerald-700 bg-emerald-950 text-sm text-emerald-100 flex items-center gap-2">
          <span className="inline-block w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
          Now: underway since {fmtUtcMinute(current.sinceMs / 1000)},{' '}
          {(current.liveDistanceM / M_PER_NM).toFixed(1)} NM
        </div>
      )}

      <div className="mb-4 flex items-center gap-3 flex-wrap text-sm">
        <label className="flex items-center gap-2">
          <span className="text-slate-400 text-xs uppercase">From</span>
          <input
            type="date"
            value={filters.from}
            onChange={(e) => writeFilters({ ...filters, from: e.target.value })}
            className="bg-slate-800 border border-slate-700 rounded px-2 py-1 font-mono"
          />
        </label>
        <label className="flex items-center gap-2">
          <span className="text-slate-400 text-xs uppercase">To</span>
          <input
            type="date"
            value={filters.to}
            onChange={(e) => writeFilters({ ...filters, to: e.target.value })}
            className="bg-slate-800 border border-slate-700 rounded px-2 py-1 font-mono"
          />
        </label>
        <button
          type="button"
          onClick={() => writeFilters(defaultFilters())}
          className="px-2 py-1 text-xs bg-slate-700 hover:bg-slate-600 rounded"
        >
          Season
        </button>
        {loading && <span className="text-xs text-slate-500">loading…</span>}
      </div>

      <section className="mb-6 grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2">
        <StatCard label="Total NM" value={stats ? stats.totalNm.toFixed(1) : '—'} />
        <StatCard label="Trips" value={stats ? String(stats.totalTrips) : '—'} />
        <StatCard
          label="Longest passage"
          value={stats?.longestTrip ? `${stats.longestTrip.nm.toFixed(1)} NM` : '—'}
          sub={stats?.longestTrip ? formatDuration(stats.longestTrip.durationS) : undefined}
        />
        <StatCard
          label="Hours underway"
          value={stats ? (stats.totalUnderwayS / 3600).toFixed(1) : '—'}
        />
        <StatCard label="Nights at anchor" value={stats ? String(stats.nightsAtAnchor) : '—'} />
        <StatCard
          label="Max SOG"
          value={
            stats?.maxSogKn !== null && stats !== null ? `${stats.maxSogKn.toFixed(1)} kn` : '—'
          }
        />
      </section>

      {err && <p className="mb-4 text-sm text-red-400">{err}</p>}

      {grouped.length === 0 && !loading ? (
        <div className="text-slate-500 italic text-sm">
          No trips in this window. The detector records one automatically each time the boat gets
          underway.
        </div>
      ) : (
        grouped.map((day) => (
          <section key={day.ymd} className="mb-6">
            <div className="text-xs text-slate-400 font-mono mb-2 border-b border-slate-800 pb-1">
              {day.ymd} UTC · {day.rows.length} {day.rows.length === 1 ? 'trip' : 'trips'}
            </div>
            <div className="space-y-2">
              {day.rows.map((t) => (
                <TripRow
                  key={t.id}
                  trip={t}
                  onPatch={(patch) => patchTrip(t.id, patch)}
                  onDelete={() => void deleteTrip(t.id)}
                />
              ))}
            </div>
          </section>
        ))
      )}

      {hasMore && (
        <button
          type="button"
          onClick={() => void loadTrips(trips[trips.length - 1]?.startMs)}
          disabled={loading}
          className="w-full px-3 py-2 text-sm rounded bg-slate-800 hover:bg-slate-700 border border-slate-700 disabled:opacity-50"
        >
          {loading ? 'Loading…' : 'Load more'}
        </button>
      )}
    </main>
  );
}

function StatCard({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="bg-slate-900 border border-slate-800 rounded p-3">
      <div className="text-[10px] uppercase tracking-wider text-slate-400">{label}</div>
      <div className="mt-1 text-lg font-semibold font-mono">{value}</div>
      {sub && <div className="text-xs text-slate-500 font-mono">{sub}</div>}
    </div>
  );
}

/** Mini stacked bar of point-of-sail time shares. */
function PosBar({ pos }: { pos: Record<string, number> }) {
  const total = Object.values(pos).reduce((a, b) => a + b, 0);
  if (!(total > 0)) return null;
  const known = POS_ORDER.filter((k) => k in pos);
  const extra = Object.keys(pos).filter((k) => !(POS_ORDER as readonly string[]).includes(k));
  const keys = [...known, ...extra];
  const title = keys.map((k) => `${k} ${Math.round(((pos[k] ?? 0) / total) * 100)}%`).join(' · ');
  return (
    <div className="flex h-1.5 w-24 rounded overflow-hidden bg-slate-800" title={title}>
      {keys.map((k) => (
        <div
          key={k}
          className={POS_COLOR[k] ?? 'bg-slate-500'}
          style={{ width: `${((pos[k] ?? 0) / total) * 100}%` }}
        />
      ))}
    </div>
  );
}

function TripRow({
  trip,
  onPatch,
  onDelete,
}: {
  trip: Trip;
  onPatch: (patch: {
    mode?: TripMode;
    moorageStartName?: string | null;
    moorageEndName?: string | null;
    notes?: string | null;
  }) => Promise<void>;
  onDelete: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [editMode, setEditMode] = useState<TripMode>(trip.mode);
  const [editStart, setEditStart] = useState(trip.moorageStartName ?? '');
  const [editEnd, setEditEnd] = useState(trip.moorageEndName ?? '');
  const [editNotes, setEditNotes] = useState(trip.notes ?? '');

  const start = fmtUtc(trip.startMs);
  const end = fmtUtc(trip.endMs);
  const nm = trip.distanceM / M_PER_NM;
  const moorage =
    trip.moorageStartName || trip.moorageEndName
      ? `${trip.moorageStartName ?? '—'} → ${trip.moorageEndName ?? '—'}`
      : null;

  const beginEdit = (): void => {
    setEditMode(trip.mode);
    setEditStart(trip.moorageStartName ?? '');
    setEditEnd(trip.moorageEndName ?? '');
    setEditNotes(trip.notes ?? '');
    setSaveError(null);
    setEditing(true);
  };

  const save = async (): Promise<void> => {
    setSaving(true);
    setSaveError(null);
    try {
      await onPatch({
        mode: editMode,
        moorageStartName: editStart.trim() || null,
        moorageEndName: editEnd.trim() || null,
        notes: editNotes.trim() || null,
      });
      setEditing(false);
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <article className="bg-slate-900 border border-slate-800 rounded p-3">
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="w-full flex items-center gap-3 flex-wrap text-left"
      >
        <span className="font-mono text-sm text-slate-100">
          {start.hm} → {end.hm}
          {end.ymd !== start.ymd && <span className="text-slate-500"> ({end.ymd})</span>}
        </span>
        <span className="text-xs text-slate-400 font-mono">{fmtDurationS(trip.durationS)}</span>
        <span className="text-sm font-mono">{nm.toFixed(1)} NM</span>
        <span className="text-xs text-slate-400 font-mono">
          {trip.avgSogKn.toFixed(1)} / {trip.maxSogKn.toFixed(1)} kn
        </span>
        <span
          className={`px-1.5 py-0.5 rounded text-[10px] uppercase tracking-wide ${MODE_BADGE[trip.mode]}`}
        >
          {trip.mode}
        </span>
        {trip.stayKind === 'anchor' && (
          <span className="text-sky-300" title="Stay after this trip: at anchor">
            ⚓
          </span>
        )}
        {moorage && <span className="text-xs text-slate-300 truncate">{moorage}</span>}
        {trip.pointOfSail && <PosBar pos={trip.pointOfSail} />}
        <span className="ml-auto text-xs text-slate-500">{expanded ? '▼' : '▶'}</span>
      </button>

      {expanded && (
        <div className="mt-3 pt-3 border-t border-slate-800 text-xs text-slate-300 space-y-2">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-1 font-mono">
            <div>
              <span className="text-slate-500">Start </span>
              {fmtUtcMinute(trip.startMs / 1000)} · {fmtLatLonDmm(trip.startLat, trip.startLon)}
            </div>
            <div>
              <span className="text-slate-500">End </span>
              {fmtUtcMinute(trip.endMs / 1000)} · {fmtLatLonDmm(trip.endLat, trip.endLon)}
            </div>
            <div>
              <span className="text-slate-500">Stay after </span>
              {trip.stayDurationS !== null ? fmtDurationS(trip.stayDurationS) : '—'}
              {trip.stayKind === 'anchor' ? ' at anchor' : ''}
            </div>
            <div>
              <span className="text-slate-500">Recorded </span>
              {fmtUtcMinute(trip.createdMs / 1000)}
            </div>
          </div>

          {!editing && trip.notes && (
            <div className="whitespace-pre-wrap break-words text-slate-200">{trip.notes}</div>
          )}

          {editing ? (
            <div className="space-y-2">
              <div className="flex items-center gap-3 flex-wrap">
                <label className="flex items-center gap-2">
                  <span className="text-slate-400 uppercase">Mode</span>
                  <select
                    value={editMode}
                    onChange={(e) => setEditMode(e.target.value as TripMode)}
                    className="bg-slate-800 border border-slate-700 rounded px-2 py-1"
                  >
                    {(['sail', 'motor', 'mixed', 'unknown'] as const).map((m) => (
                      <option key={m} value={m}>
                        {m}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="flex items-center gap-2">
                  <span className="text-slate-400 uppercase">From</span>
                  <input
                    type="text"
                    value={editStart}
                    onChange={(e) => setEditStart(e.target.value)}
                    placeholder="moorage name"
                    className="bg-slate-800 border border-slate-700 rounded px-2 py-1 w-40"
                  />
                </label>
                <label className="flex items-center gap-2">
                  <span className="text-slate-400 uppercase">To</span>
                  <input
                    type="text"
                    value={editEnd}
                    onChange={(e) => setEditEnd(e.target.value)}
                    placeholder="moorage name"
                    className="bg-slate-800 border border-slate-700 rounded px-2 py-1 w-40"
                  />
                </label>
              </div>
              <textarea
                value={editNotes}
                onChange={(e) => setEditNotes(e.target.value)}
                placeholder="Notes"
                rows={3}
                className="w-full bg-slate-950 border border-slate-700 rounded p-2 font-mono focus:outline-none focus:border-amber-600"
              />
              {saveError && <div className="text-red-400">{saveError}</div>}
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => void save()}
                  disabled={saving}
                  className="px-2 py-1 bg-emerald-700 hover:bg-emerald-600 text-white rounded disabled:opacity-50"
                >
                  {saving ? 'Saving…' : 'Save'}
                </button>
                <button
                  type="button"
                  onClick={() => setEditing(false)}
                  className="px-2 py-1 bg-slate-700 hover:bg-slate-600 rounded"
                >
                  Cancel
                </button>
              </div>
            </div>
          ) : (
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={beginEdit}
                className="px-2 py-1 bg-slate-700 hover:bg-slate-600 rounded"
              >
                Edit
              </button>
              <button
                type="button"
                onClick={onDelete}
                className="px-2 py-1 bg-red-900 hover:bg-red-800 text-red-100 rounded"
              >
                Delete
              </button>
            </div>
          )}
        </div>
      )}
    </article>
  );
}
