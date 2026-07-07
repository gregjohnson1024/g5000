'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { fmtLatLonDmm } from '../../../lib/coords';
import { formatDuration, fmtUtcMinute } from '../../../lib/tz';
import { Button, ConfirmDialog, RecordList, StatusChip } from '../../../components/ui';
import type { RecordItem } from '../../../components/ui';

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

// ---------------------------------------------------------------------------
// StatusChip mapping for trip mode (replaces raw MODE_BADGE classes)
// ---------------------------------------------------------------------------

type ModeChipKind = 'ok' | 'warn' | 'info' | 'neutral';

const MODE_CHIP_KIND: Record<TripMode, ModeChipKind> = {
  sail: 'ok',
  motor: 'warn',
  mixed: 'info',
  unknown: 'neutral',
};

// ---------------------------------------------------------------------------
// Point-of-sail bar (token colors via StatusChip kinds)
// ---------------------------------------------------------------------------

const POS_ORDER = ['upwind', 'reaching', 'downwind', 'not-sailing'] as const;

// Maps point-of-sail categories to StatusChip kinds for the bar segments.
// POS_COLOR raw classes (bg-sky-500, etc.) are replaced by token-safe inline
// styles using CSS variables from the palette.
const POS_CSS: Record<string, string> = {
  upwind: 'var(--info)',
  reaching: 'var(--ok)',
  downwind: 'var(--series-4)', // violet — series token
  'not-sailing': 'var(--stale)',
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

// ---------------------------------------------------------------------------
// RecordList kind options
// ---------------------------------------------------------------------------

const KIND_OPTIONS = [{ value: 'trip', label: 'Trips' }];
// NOTE: Track and passage-log feeds are a follow-up task. The kind filter
// control is present (using RecordList's built-in kindOptions prop) and will
// expand to include 'track' and 'log' once those APIs are integrated.

// ---------------------------------------------------------------------------
// StatCard — trips' StatCard grammar (keep-list: VERBATIM)
// ---------------------------------------------------------------------------

function StatCard({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="bg-surface border border-hairline [border-radius:var(--r-panel)] p-3">
      <div className="text-label uppercase tracking-wider text-ink-2">{label}</div>
      <div className="mt-1 text-[1.5rem] font-semibold font-mono tabular-nums text-ink-value">
        {value}
      </div>
      {sub && <div className="text-caption text-ink-3 font-mono">{sub}</div>}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Mini stacked bar of point-of-sail time shares (token-safe)
// ---------------------------------------------------------------------------

function PosBar({ pos }: { pos: Record<string, number> }) {
  const total = Object.values(pos).reduce((a, b) => a + b, 0);
  if (!(total > 0)) return null;
  const known = POS_ORDER.filter((k) => k in pos);
  const extra = Object.keys(pos).filter((k) => !(POS_ORDER as readonly string[]).includes(k));
  const keys = [...known, ...extra];
  const title = keys.map((k) => `${k} ${Math.round(((pos[k] ?? 0) / total) * 100)}%`).join(' · ');
  return (
    <div className="flex h-1.5 w-24 rounded overflow-hidden bg-surface-raised" title={title}>
      {keys.map((k) => (
        <div
          key={k}
          style={{
            width: `${((pos[k] ?? 0) / total) * 100}%`,
            backgroundColor: POS_CSS[k] ?? 'var(--stale)',
          }}
        />
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// TripRow — expandable trip record
// ---------------------------------------------------------------------------

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
    <article className="bg-surface border border-hairline [border-radius:var(--r-panel)] p-3">
      {/* Summary row — expand toggle */}
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="w-full flex items-center gap-3 flex-wrap text-left min-h-[44px]"
      >
        <span className="font-mono text-body-sm text-ink">
          {start.hm} → {end.hm}
          {end.ymd !== start.ymd && <span className="text-ink-3"> ({end.ymd})</span>}
        </span>
        <span className="text-caption text-ink-2 font-mono">{fmtDurationS(trip.durationS)}</span>
        <span className="text-body-sm font-mono tabular-nums">{nm.toFixed(1)} NM</span>
        <span className="text-caption text-ink-2 font-mono tabular-nums">
          {trip.avgSogKn.toFixed(1)} / {trip.maxSogKn.toFixed(1)} kn
        </span>
        {/* Mode chip: MODE_BADGE replaced by StatusChip */}
        <StatusChip kind={MODE_CHIP_KIND[trip.mode]} label={trip.mode} />
        {trip.stayKind === 'anchor' && <StatusChip kind="info" label="anchor" />}
        {moorage && <span className="text-caption text-ink-2 truncate">{moorage}</span>}
        {trip.pointOfSail && <PosBar pos={trip.pointOfSail} />}
        <span className="ml-auto text-caption text-ink-3" aria-hidden="true">
          {expanded ? '▼' : '▶'}
        </span>
      </button>

      {/* Expanded detail */}
      {expanded && (
        <div className="mt-3 pt-3 border-t border-hairline text-caption text-ink-2 space-y-2">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-1 font-mono">
            <div>
              <span className="text-ink-3">Start </span>
              {fmtUtcMinute(trip.startMs / 1000)} · {fmtLatLonDmm(trip.startLat, trip.startLon)}
            </div>
            <div>
              <span className="text-ink-3">End </span>
              {fmtUtcMinute(trip.endMs / 1000)} · {fmtLatLonDmm(trip.endLat, trip.endLon)}
            </div>
            <div>
              <span className="text-ink-3">Stay after </span>
              {trip.stayDurationS !== null ? fmtDurationS(trip.stayDurationS) : '—'}
              {trip.stayKind === 'anchor' ? ' at anchor' : ''}
            </div>
            <div>
              <span className="text-ink-3">Recorded </span>
              {fmtUtcMinute(trip.createdMs / 1000)}
            </div>
          </div>

          {!editing && trip.notes && (
            <div className="whitespace-pre-wrap break-words text-ink">{trip.notes}</div>
          )}

          {editing ? (
            <div className="space-y-2">
              <div className="flex items-center gap-3 flex-wrap">
                <label className="flex items-center gap-2">
                  <span className="text-label uppercase text-ink-2">Mode</span>
                  <select
                    value={editMode}
                    onChange={(e) => setEditMode(e.target.value as TripMode)}
                    className="bg-surface-sunken border border-hairline rounded-[--r-control] px-2 py-1 text-ink focus:outline-none focus-visible:ring-2 focus-visible:ring-[--focus]"
                  >
                    {(['sail', 'motor', 'mixed', 'unknown'] as const).map((m) => (
                      <option key={m} value={m}>
                        {m}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="flex items-center gap-2">
                  <span className="text-label uppercase text-ink-2">From</span>
                  <input
                    type="text"
                    value={editStart}
                    onChange={(e) => setEditStart(e.target.value)}
                    placeholder="moorage name"
                    className="bg-surface-sunken border border-hairline rounded-[--r-control] px-2 py-1 w-40 text-ink focus:outline-none focus-visible:ring-2 focus-visible:ring-[--focus]"
                  />
                </label>
                <label className="flex items-center gap-2">
                  <span className="text-label uppercase text-ink-2">To</span>
                  <input
                    type="text"
                    value={editEnd}
                    onChange={(e) => setEditEnd(e.target.value)}
                    placeholder="moorage name"
                    className="bg-surface-sunken border border-hairline rounded-[--r-control] px-2 py-1 w-40 text-ink focus:outline-none focus-visible:ring-2 focus-visible:ring-[--focus]"
                  />
                </label>
              </div>
              <textarea
                value={editNotes}
                onChange={(e) => setEditNotes(e.target.value)}
                placeholder="Notes"
                rows={3}
                className="w-full bg-surface-sunken border border-hairline rounded-[--r-control] p-2 font-mono text-ink focus:outline-none focus-visible:ring-2 focus-visible:ring-[--focus] resize-y"
              />
              {saveError && <div className="text-danger text-caption">{saveError}</div>}
              <div className="flex items-center gap-2">
                <Button size="sm" variant="primary" onClick={() => void save()} disabled={saving}>
                  {saving ? 'Saving…' : 'Save'}
                </Button>
                <Button size="sm" variant="secondary" onClick={() => setEditing(false)}>
                  Cancel
                </Button>
              </div>
            </div>
          ) : (
            /* Edit and Delete separated by gap (44px effective targets) */
            <div className="flex items-center gap-3 pt-1">
              <Button size="sm" variant="secondary" onClick={beginEdit}>
                Edit
              </Button>
              <Button size="sm" variant="danger" onClick={onDelete}>
                Delete
              </Button>
            </div>
          )}
        </div>
      )}
    </article>
  );
}

// ---------------------------------------------------------------------------
// Main export
// ---------------------------------------------------------------------------

export function TripsClientView() {
  const [filters, setFilters] = useState<FiltersState>(defaultFilters);
  const [filtersLoaded, setFiltersLoaded] = useState(false);
  const [stats, setStats] = useState<TripStats | null>(null);
  const [trips, setTrips] = useState<Trip[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [current, setCurrent] = useState<CurrentSnapshot | null>(null);

  // Delete confirmation: null = no dialog; otherwise the trip pending deletion
  const [pendingDeleteTrip, setPendingDeleteTrip] = useState<Trip | null>(null);

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
    setTrips((prev) =>
      prev.map((t) => (t.id === id ? { ...updated, stayDurationS: t.stayDurationS } : t)),
    );
    void loadStats();
  };

  const requestDeleteTrip = (trip: Trip): void => {
    setPendingDeleteTrip(trip);
  };

  const confirmDeleteTrip = async (): Promise<void> => {
    if (!pendingDeleteTrip) return;
    const { id } = pendingDeleteTrip;
    setPendingDeleteTrip(null);
    const r = await fetch(`/api/trips/${id}`, { method: 'DELETE' });
    const j = (await r.json()) as { ok: boolean; error?: { message: string } };
    if (!j.ok) {
      setErr(j.error?.message ?? 'delete failed');
      return;
    }
    await reloadAll();
  };

  // Build RecordList items from trips
  const recordItems: RecordItem[] = useMemo(
    () =>
      trips.map((t) => ({
        id: t.id,
        kind: 'trip',
        tMs: t.startMs,
        render: () => (
          <TripRow
            trip={t}
            onPatch={(patch) => patchTrip(t.id, patch)}
            onDelete={() => requestDeleteTrip(t)}
          />
        ),
      })),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [trips],
  );

  return (
    <main className="p-4 max-w-5xl mx-auto text-ink">
      <div className="flex items-baseline justify-between mb-4">
        <h1 className="text-[1.111rem] font-semibold text-ink-value">Logbook</h1>
        <div className="text-caption text-ink-2 font-mono tabular-nums">
          UTC · {trips.length} loaded
        </div>
      </div>

      {/* Live underway banner */}
      {current?.state === 'underway' && (
        <div className="mb-4 px-3 py-2 [border-radius:var(--r-panel)] border border-ok bg-ok/10 text-body-sm text-ok flex items-center gap-2">
          <span className="inline-block w-2 h-2 rounded-full bg-ok animate-pulse" />
          Now: underway since {fmtUtcMinute(current.sinceMs / 1000)},{' '}
          {(current.liveDistanceM / M_PER_NM).toFixed(1)} NM
        </div>
      )}

      {/* Date filters */}
      <div className="mb-4 flex items-center gap-3 flex-wrap text-body-sm">
        <label className="flex items-center gap-2">
          <span className="text-label uppercase text-ink-2">From</span>
          <input
            type="date"
            value={filters.from}
            onChange={(e) => writeFilters({ ...filters, from: e.target.value })}
            className="bg-surface-sunken border border-hairline rounded-[--r-control] px-2 py-1 font-mono text-ink focus:outline-none focus-visible:ring-2 focus-visible:ring-[--focus]"
          />
        </label>
        <label className="flex items-center gap-2">
          <span className="text-label uppercase text-ink-2">To</span>
          <input
            type="date"
            value={filters.to}
            onChange={(e) => writeFilters({ ...filters, to: e.target.value })}
            className="bg-surface-sunken border border-hairline rounded-[--r-control] px-2 py-1 font-mono text-ink focus:outline-none focus-visible:ring-2 focus-visible:ring-[--focus]"
          />
        </label>
        <Button size="sm" variant="secondary" onClick={() => writeFilters(defaultFilters())}>
          Season
        </Button>
        {loading && <span className="text-caption text-ink-3">loading…</span>}
      </div>

      {/* StatCards — keep-list: StatCard grammar VERBATIM */}
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

      {err && <p className="mb-4 text-body-sm text-danger">{err}</p>}

      {/* RecordList — kind filter + UTC day-grouped feed */}
      <RecordList
        items={recordItems}
        kindOptions={KIND_OPTIONS}
        emptyLabel={
          loading
            ? 'Loading…'
            : 'No trips in this window. The detector records one automatically each time the boat gets underway.'
        }
      />

      {hasMore && (
        <Button
          variant="secondary"
          className="w-full mt-4"
          onClick={() => void loadTrips(trips[trips.length - 1]?.startMs)}
          disabled={loading}
        >
          {loading ? 'Loading…' : 'Load more'}
        </Button>
      )}

      <ConfirmDialog
        open={pendingDeleteTrip !== null}
        onClose={() => setPendingDeleteTrip(null)}
        onConfirm={() => void confirmDeleteTrip()}
        title="Delete trip?"
        message={
          pendingDeleteTrip
            ? (() => {
                const { ymd, hm } = fmtUtc(pendingDeleteTrip.startMs);
                const nm = (pendingDeleteTrip.distanceM / M_PER_NM).toFixed(1);
                return `Delete trip ${ymd} ${hm} UTC — ${nm} NM? This cannot be undone.`;
              })()
            : ''
        }
        confirmLabel="Delete"
      />
    </main>
  );
}
