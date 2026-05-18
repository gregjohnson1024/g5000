'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import type { JsonSafeSample } from '@g5000/core';
import { useSse } from '../../hooks/use-sse';
import { fmtLatLonDmm } from '../../lib/format-coords';

const RAD_TO_DEG = 180 / Math.PI;
const MS_TO_KN = 1 / 0.514444;
const KINDS = ['note', 'weather', 'equipment', 'incident', 'crew'] as const;
type ManualKind = (typeof KINDS)[number];

interface LogEntry {
  id: number;
  tsMs: number;
  source: 'manual' | 'auto';
  kind: string;
  text: string | null;
  lat: number | null;
  lon: number | null;
  cogDeg: number | null;
  sogKn: number | null;
  hdgDeg: number | null;
  twsKn: number | null;
  twdDeg: number | null;
  author: string | null;
  boatId: string;
}

function geo(s: JsonSafeSample | undefined): { lat: number; lon: number } | null {
  return s && s.value.kind === 'geo' ? s.value.value : null;
}
function scalar(s: JsonSafeSample | undefined): number | null {
  return s && s.value.kind === 'scalar' ? s.value.value : null;
}

const KIND_BG: Record<string, string> = {
  note: 'bg-slate-700 text-slate-100',
  weather: 'bg-sky-800 text-sky-100',
  equipment: 'bg-amber-800 text-amber-100',
  incident: 'bg-red-800 text-red-100',
  crew: 'bg-purple-800 text-purple-100',
  position: 'bg-slate-800 text-slate-400',
};

function fmtUtc(ms: number): { ymd: string; hms: string } {
  const d = new Date(ms);
  const pad = (n: number, w = 2): string => String(n).padStart(w, '0');
  return {
    ymd: `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`,
    hms: `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}`,
  };
}

function normDeg(deg: number | null | undefined): string {
  if (deg === null || deg === undefined || !Number.isFinite(deg)) return '—';
  const v = ((deg % 360) + 360) % 360;
  return `${String(Math.round(v)).padStart(3, '0')}°`;
}

export function LogClientView() {
  const { channels } = useSse();

  // Snapshot live nav for the compose form to attach to manual entries.
  // Each render recomputes — by the time the user submits, the snapshot
  // matches the current SSE state.
  const livePos = geo(channels.get('nav.gps.position'));
  const liveCogRad = scalar(channels.get('nav.gps.cog'));
  const liveSogMs = scalar(channels.get('nav.gps.sog'));
  const liveHdgRad = scalar(channels.get('boat.heading.magnetic'));
  const liveTwsMs = scalar(channels.get('wind.true.speed'));
  const liveTwdRad = scalar(channels.get('wind.true.direction'));

  const liveSnapshot = useMemo(
    () => ({
      lat: livePos?.lat,
      lon: livePos?.lon,
      cogDeg: liveCogRad !== null ? (((liveCogRad * RAD_TO_DEG) % 360) + 360) % 360 : undefined,
      sogKn: liveSogMs !== null ? liveSogMs * MS_TO_KN : undefined,
      hdgDeg: liveHdgRad !== null ? (((liveHdgRad * RAD_TO_DEG) % 360) + 360) % 360 : undefined,
      twsKn: liveTwsMs !== null ? liveTwsMs * MS_TO_KN : undefined,
      twdDeg: liveTwdRad !== null ? (((liveTwdRad * RAD_TO_DEG) % 360) + 360) % 360 : undefined,
    }),
    [livePos, liveCogRad, liveSogMs, liveHdgRad, liveTwsMs, liveTwdRad],
  );

  const [entries, setEntries] = useState<LogEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [filterSource, setFilterSource] = useState<'all' | 'manual' | 'auto'>('all');
  const [filterKind, setFilterKind] = useState<string>('all');
  const [search, setSearch] = useState('');

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const url = new URL('/api/log', window.location.origin);
      url.searchParams.set('limit', '200');
      if (filterSource !== 'all') url.searchParams.set('source', filterSource);
      if (filterKind !== 'all') url.searchParams.set('kind', filterKind);
      if (search.trim().length > 0) url.searchParams.set('q', search.trim());
      const r = await fetch(url.toString(), { cache: 'no-store' });
      if (!r.ok) return;
      const j = (await r.json()) as { entries: LogEntry[] };
      setEntries(j.entries);
    } finally {
      setLoading(false);
    }
  }, [filterSource, filterKind, search]);

  useEffect(() => {
    void reload();
  }, [reload]);

  // Refresh every 30s so a hot-off-the-press auto entry appears without
  // a manual reload. Faster than that adds nothing — auto entries are hourly.
  useEffect(() => {
    const t = setInterval(() => void reload(), 30_000);
    return () => clearInterval(t);
  }, [reload]);

  // Compose form
  const [composeText, setComposeText] = useState('');
  const [composeKind, setComposeKind] = useState<ManualKind>('note');
  const [composeAuthor, setComposeAuthor] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  // Persist author across visits so crew don't retype.
  useEffect(() => {
    try {
      const saved = localStorage.getItem('shipLog:author');
      if (saved) setComposeAuthor(saved);
    } catch {
      /* private mode */
    }
  }, []);
  useEffect(() => {
    try {
      localStorage.setItem('shipLog:author', composeAuthor);
    } catch {
      /* private mode */
    }
  }, [composeAuthor]);

  const submit = async (): Promise<void> => {
    if (composeText.trim().length === 0) return;
    setSubmitting(true);
    setSubmitError(null);
    try {
      const r = await fetch('/api/log', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text: composeText.trim(),
          kind: composeKind,
          author: composeAuthor.trim() || undefined,
          ...liveSnapshot,
        }),
      });
      const j = (await r.json()) as { ok?: boolean; error?: string };
      if (!j.ok) {
        setSubmitError(j.error ?? 'submit failed');
      } else {
        setComposeText('');
        await reload();
      }
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : 'submit failed');
    } finally {
      setSubmitting(false);
    }
  };

  const removeEntry = async (id: number): Promise<void> => {
    if (!confirm('Delete this entry? This cannot be undone.')) return;
    const r = await fetch(`/api/log/${id}`, { method: 'DELETE' });
    if (r.ok) await reload();
  };

  // Group entries by UTC day for visual hierarchy.
  const grouped = useMemo(() => {
    const out: Array<{ ymd: string; rows: LogEntry[] }> = [];
    let current: { ymd: string; rows: LogEntry[] } | null = null;
    for (const e of entries) {
      const ymd = fmtUtc(e.tsMs).ymd;
      if (!current || current.ymd !== ymd) {
        current = { ymd, rows: [] };
        out.push(current);
      }
      current.rows.push(e);
    }
    return out;
  }, [entries]);

  return (
    <main className="p-4 max-w-5xl mx-auto text-slate-100">
      <div className="flex items-baseline justify-between mb-4">
        <h1 className="text-2xl font-semibold">Ship's log</h1>
        <div className="text-xs text-slate-400 font-mono">UTC · {entries.length} entries</div>
      </div>

      <section className="mb-6 bg-slate-900 border border-slate-800 rounded p-4">
        <div className="text-xs uppercase tracking-wider text-slate-400 mb-2">New entry</div>
        <textarea
          value={composeText}
          onChange={(e) => setComposeText(e.target.value)}
          placeholder="What happened? (e.g. set #2 reefed main, oil pressure normal, dolphins on starboard bow)"
          rows={3}
          className="w-full bg-slate-950 border border-slate-700 rounded p-2 font-mono text-sm focus:outline-none focus:border-amber-600"
        />
        <div className="mt-2 flex items-center gap-3 flex-wrap text-sm">
          <label className="flex items-center gap-2">
            <span className="text-slate-400 text-xs uppercase">Kind</span>
            <select
              value={composeKind}
              onChange={(e) => setComposeKind(e.target.value as ManualKind)}
              className="bg-slate-800 border border-slate-700 rounded px-2 py-1"
            >
              {KINDS.map((k) => (
                <option key={k} value={k}>
                  {k}
                </option>
              ))}
            </select>
          </label>
          <label className="flex items-center gap-2">
            <span className="text-slate-400 text-xs uppercase">Author</span>
            <input
              type="text"
              value={composeAuthor}
              onChange={(e) => setComposeAuthor(e.target.value)}
              placeholder="optional"
              className="bg-slate-800 border border-slate-700 rounded px-2 py-1 w-32 font-mono"
            />
          </label>
          <div className="text-xs text-slate-500 font-mono">
            {liveSnapshot.lat !== undefined && liveSnapshot.lon !== undefined
              ? `will attach: ${fmtLatLonDmm(liveSnapshot.lat, liveSnapshot.lon)}`
              : 'no live position'}
          </div>
          <button
            type="button"
            onClick={() => void submit()}
            disabled={submitting || composeText.trim().length === 0}
            className="ml-auto px-3 py-1 rounded bg-amber-600 text-slate-900 font-medium hover:bg-amber-500 disabled:bg-slate-700 disabled:text-slate-500"
          >
            {submitting ? 'Saving…' : 'Add entry'}
          </button>
        </div>
        {submitError && <div className="mt-2 text-xs text-red-400">{submitError}</div>}
      </section>

      <div className="mb-4 flex items-center gap-3 flex-wrap text-sm">
        <label className="flex items-center gap-2">
          <span className="text-slate-400 text-xs uppercase">Source</span>
          <select
            value={filterSource}
            onChange={(e) => setFilterSource(e.target.value as 'all' | 'manual' | 'auto')}
            className="bg-slate-800 border border-slate-700 rounded px-2 py-1"
          >
            <option value="all">all</option>
            <option value="manual">manual</option>
            <option value="auto">auto</option>
          </select>
        </label>
        <label className="flex items-center gap-2">
          <span className="text-slate-400 text-xs uppercase">Kind</span>
          <select
            value={filterKind}
            onChange={(e) => setFilterKind(e.target.value)}
            className="bg-slate-800 border border-slate-700 rounded px-2 py-1"
          >
            <option value="all">all</option>
            <option value="note">note</option>
            <option value="position">position</option>
            <option value="weather">weather</option>
            <option value="equipment">equipment</option>
            <option value="incident">incident</option>
            <option value="crew">crew</option>
          </select>
        </label>
        <label className="flex items-center gap-2 flex-1 min-w-[200px]">
          <span className="text-slate-400 text-xs uppercase">Search</span>
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="text or author"
            className="bg-slate-800 border border-slate-700 rounded px-2 py-1 font-mono flex-1"
          />
        </label>
        {loading && <span className="text-xs text-slate-500">loading…</span>}
      </div>

      {grouped.length === 0 ? (
        <div className="text-slate-500 italic text-sm">
          No entries yet. Add one above, or wait for the hourly auto-logger.
        </div>
      ) : (
        grouped.map((day) => (
          <section key={day.ymd} className="mb-6">
            <div className="text-xs text-slate-400 font-mono mb-2 border-b border-slate-800 pb-1">
              {day.ymd} UTC · {day.rows.length} {day.rows.length === 1 ? 'entry' : 'entries'}
            </div>
            <div className="space-y-2">
              {day.rows.map((e) => (
                <EntryRow key={e.id} entry={e} onDelete={() => void removeEntry(e.id)} />
              ))}
            </div>
          </section>
        ))
      )}
    </main>
  );
}

function EntryRow({
  entry,
  onDelete,
}: {
  entry: LogEntry;
  onDelete: () => void;
}) {
  const { hms } = fmtUtc(entry.tsMs);
  const chip = KIND_BG[entry.kind] ?? 'bg-slate-700 text-slate-100';
  const isAuto = entry.source === 'auto';
  return (
    <article
      className={`border rounded p-3 ${
        isAuto ? 'bg-slate-950 border-slate-800' : 'bg-slate-900 border-slate-700'
      }`}
    >
      <div className="flex items-start gap-3">
        <div className="flex flex-col items-center min-w-[64px]">
          <div className="font-mono text-sm text-slate-100">{hms}</div>
          <span
            className={`mt-1 px-1.5 py-0.5 rounded text-[10px] uppercase tracking-wide ${chip}`}
          >
            {entry.kind}
          </span>
          {entry.source === 'auto' && (
            <span className="mt-1 text-[10px] text-slate-500 uppercase">auto</span>
          )}
        </div>
        <div className="flex-1 min-w-0">
          {entry.text && (
            <div className="text-sm text-slate-100 whitespace-pre-wrap break-words">
              {entry.text}
            </div>
          )}
          <div className="mt-1 text-xs text-slate-400 font-mono flex flex-wrap gap-x-3 gap-y-0.5">
            {entry.lat !== null && entry.lon !== null && (
              <span>{fmtLatLonDmm(entry.lat, entry.lon)}</span>
            )}
            {entry.cogDeg !== null && (
              <span>
                COG {normDeg(entry.cogDeg)}
                {entry.sogKn !== null ? ` · SOG ${entry.sogKn.toFixed(1)} kn` : ''}
              </span>
            )}
            {entry.hdgDeg !== null && <span>HDG {normDeg(entry.hdgDeg)}M</span>}
            {entry.twsKn !== null && (
              <span>
                TWS {entry.twsKn.toFixed(1)} kn
                {entry.twdDeg !== null ? ` @ ${normDeg(entry.twdDeg)}T` : ''}
              </span>
            )}
            {entry.author && <span className="text-slate-500">— {entry.author}</span>}
          </div>
        </div>
        {entry.source === 'manual' && (
          <button
            type="button"
            onClick={onDelete}
            className="text-xs text-slate-500 hover:text-red-400 px-2 py-1"
            title="Delete entry"
          >
            ×
          </button>
        )}
      </div>
    </article>
  );
}
