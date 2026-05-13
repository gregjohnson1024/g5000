'use client';
import { useCallback, useEffect, useState } from 'react';

interface TrackMeta {
  id: string;
  number: number;
  label: string;
  startedAt: string;
  endedAt: string | null;
  pointCount: number;
  totalDistanceM: number;
}

interface RecorderStatus {
  status: string;
  activeTrackId: string | null;
  pointsAppended: number;
  lastPoint?: { lat: number; lon: number; t: number } | null;
  errorMessage?: string;
}

const M_PER_NM = 1852;

function fmtUtc(iso: string): string {
  if (!iso) return '—';
  return iso.slice(0, 16).replace('T', ' ') + 'Z';
}

function fmtDurationFromIso(start: string, end: string | null): string {
  const s = Date.parse(start);
  const e = end ? Date.parse(end) : Date.now();
  if (!Number.isFinite(s) || !Number.isFinite(e)) return '—';
  const seconds = Math.max(0, Math.round((e - s) / 1000));
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m`;
  if (seconds < 86400) {
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    return `${h}h ${m}m`;
  }
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  return `${d}d ${h}h`;
}

export default function TracksPage() {
  const [list, setList] = useState<TrackMeta[]>([]);
  const [rec, setRec] = useState<RecorderStatus | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editLabel, setEditLabel] = useState('');

  const reload = useCallback(async () => {
    try {
      const r = await fetch('/api/tracks', { cache: 'no-store' });
      const j = await r.json();
      if (!j.ok) throw new Error(j.error?.message ?? 'load failed');
      setList(j.tracks);
      setRec(j.recorder);
      setErr(null);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    }
  }, []);

  useEffect(() => {
    void reload();
    const id = setInterval(() => void reload(), 5_000);
    return () => clearInterval(id);
  }, [reload]);

  const handleInterrupt = async (): Promise<void> => {
    if (!window.confirm('Stop the current track and start a fresh one?')) return;
    const label = window.prompt('Label for the new track (optional):') ?? '';
    setBusy(true);
    try {
      const r = await fetch('/api/tracks/interrupt', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ label }),
      });
      const j = await r.json();
      if (!j.ok) throw new Error(j.error?.message ?? 'interrupt failed');
      // Tell /chart's trail to drop the old breadcrumb and reload.
      if (typeof BroadcastChannel !== 'undefined') {
        const bc = new BroadcastChannel('tracks');
        bc.postMessage({ kind: 'interrupted', at: Date.now() });
        bc.close();
      }
      await reload();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const handleDelete = async (id: string): Promise<void> => {
    if (!window.confirm(`Delete ${id}? Points are gone after this.`)) return;
    setBusy(true);
    try {
      const r = await fetch(`/api/tracks/${id}`, { method: 'DELETE' });
      const j = await r.json();
      if (!j.ok) throw new Error(j.error?.message ?? 'delete failed');
      await reload();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const beginEdit = (t: TrackMeta): void => {
    setEditingId(t.id);
    setEditLabel(t.label);
  };
  const saveEdit = async (id: string): Promise<void> => {
    setBusy(true);
    try {
      const r = await fetch(`/api/tracks/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ label: editLabel }),
      });
      const j = await r.json();
      if (!j.ok) throw new Error(j.error?.message ?? 'save failed');
      setEditingId(null);
      await reload();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Tracks</h1>
        <button
          onClick={() => void handleInterrupt()}
          disabled={busy}
          className="px-3 py-1.5 bg-amber-600 hover:bg-amber-500 text-slate-900 rounded font-medium disabled:opacity-50"
        >
          Stop &amp; start new
        </button>
      </div>

      {err && <p className="text-rose-400 text-sm">{err}</p>}

      <section className="space-y-1 bg-slate-900/60 border border-slate-800 rounded p-3 text-sm">
        <div className="text-slate-400 font-medium">Recorder</div>
        {rec ? (
          <>
            <div>
              Status: <span className="font-mono text-slate-200">{rec.status}</span>
            </div>
            <div>
              Active track:{' '}
              <span className="font-mono text-slate-200">
                {rec.activeTrackId ?? '—'}
              </span>
            </div>
            <div>
              Points appended this session:{' '}
              <span className="font-mono text-slate-200">{rec.pointsAppended}</span>
            </div>
            {rec.lastPoint && (
              <div className="text-xs text-slate-500">
                Last fix: {rec.lastPoint.lat.toFixed(5)}, {rec.lastPoint.lon.toFixed(5)}
              </div>
            )}
            {rec.errorMessage && (
              <div className="text-xs text-amber-300">Warning: {rec.errorMessage}</div>
            )}
          </>
        ) : (
          <p className="text-slate-500">Loading…</p>
        )}
      </section>

      <section className="space-y-2">
        <h2 className="text-base font-semibold">Saved tracks ({list.length})</h2>
        {list.length === 0 && (
          <p className="text-sm text-slate-500">
            No tracks yet — the recorder will create one as soon as the first GPS fix arrives.
          </p>
        )}
        {list.length > 0 && (
          <table className="text-sm border-collapse">
            <thead>
              <tr className="text-left text-slate-400 border-b border-slate-800">
                <th className="p-2">#</th>
                <th className="p-2">ID</th>
                <th className="p-2">Label</th>
                <th className="p-2">Started</th>
                <th className="p-2">Ended</th>
                <th className="p-2 text-right">Duration</th>
                <th className="p-2 text-right">Distance (NM)</th>
                <th className="p-2 text-right">Points</th>
                <th className="p-2 text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {list.map((t) => {
                const active = t.endedAt === null;
                return (
                  <tr key={t.id} className="border-b border-slate-900">
                    <td className="p-2 font-mono">{t.number}</td>
                    <td className="p-2 font-mono">
                      {t.id}
                      {active && (
                        <span className="ml-1 text-[10px] uppercase text-emerald-400">live</span>
                      )}
                    </td>
                    <td className="p-2">
                      {editingId === t.id ? (
                        <input
                          type="text"
                          value={editLabel}
                          onChange={(e) => setEditLabel(e.target.value)}
                          className="px-2 py-1 bg-slate-900 border border-slate-700 rounded w-48"
                        />
                      ) : (
                        <span className="text-slate-300">{t.label || <span className="text-slate-600 italic">(no label)</span>}</span>
                      )}
                    </td>
                    <td className="p-2 font-mono text-xs">{fmtUtc(t.startedAt)}</td>
                    <td className="p-2 font-mono text-xs">{t.endedAt ? fmtUtc(t.endedAt) : '—'}</td>
                    <td className="p-2 text-right text-slate-300">
                      {fmtDurationFromIso(t.startedAt, t.endedAt)}
                    </td>
                    <td className="p-2 text-right font-mono">
                      {(t.totalDistanceM / M_PER_NM).toFixed(1)}
                    </td>
                    <td className="p-2 text-right font-mono">{t.pointCount}</td>
                    <td className="p-2 text-right space-x-1">
                      {editingId === t.id ? (
                        <>
                          <button
                            onClick={() => void saveEdit(t.id)}
                            disabled={busy}
                            className="px-2 py-1 text-xs bg-emerald-700 hover:bg-emerald-600 text-white rounded disabled:opacity-50"
                          >
                            Save
                          </button>
                          <button
                            onClick={() => setEditingId(null)}
                            className="px-2 py-1 text-xs bg-slate-700 hover:bg-slate-600 rounded"
                          >
                            Cancel
                          </button>
                        </>
                      ) : (
                        <>
                          <button
                            onClick={() => beginEdit(t)}
                            className="px-2 py-1 text-xs bg-slate-700 hover:bg-slate-600 rounded"
                          >
                            Edit
                          </button>
                          {!active && (
                            <button
                              onClick={() => void handleDelete(t.id)}
                              disabled={busy}
                              className="px-2 py-1 text-xs bg-red-900 hover:bg-red-800 text-red-100 rounded disabled:opacity-50"
                            >
                              Delete
                            </button>
                          )}
                        </>
                      )}
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
