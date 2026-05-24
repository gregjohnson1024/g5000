'use client';
import { Fragment, useCallback, useEffect, useState } from 'react';
import type { TrackAnnotation } from '../../lib/tracks';

interface TrackMeta {
  id: string;
  number: number;
  label: string;
  startedAt: string;
  endedAt: string | null;
  pointCount: number;
  totalDistanceM: number;
}

interface SliceData {
  points: Array<{ t: number; lat: number; lon: number }>;
  annotations: TrackAnnotation[];
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

function fmtDurationMs(ms: number): string {
  const seconds = Math.max(0, Math.round(ms / 1000));
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

function fmtDurationFromIso(start: string, end: string | null): string {
  const s = Date.parse(start);
  const e = end ? Date.parse(end) : Date.now();
  if (!Number.isFinite(s) || !Number.isFinite(e)) return '—';
  return fmtDurationMs(e - s);
}

// Full UTC timestamp for an annotation's hover title, e.g. "2026-05-23 14:32Z".
function fmtUtcMs(ms: number): string {
  if (!Number.isFinite(ms)) return '—';
  return new Date(ms).toISOString().slice(0, 16).replace('T', ' ') + 'Z';
}

export default function TracksPage() {
  const [list, setList] = useState<TrackMeta[]>([]);
  const [rec, setRec] = useState<RecorderStatus | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editLabel, setEditLabel] = useState('');
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [loadedAnnotations, setLoadedAnnotations] = useState<Record<string, TrackAnnotation[]>>({});
  const [openSlice, setOpenSlice] = useState<{
    trackId: string;
    fromMs: number;
    toMs: number;
    fromLabel: string;
    toLabel: string;
  } | null>(null);
  const [sliceData, setSliceData] = useState<SliceData | null>(null);

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

  const toggleExpand = async (id: string): Promise<void> => {
    const nowOpen = !(expanded[id] ?? false);
    setExpanded((e) => ({ ...e, [id]: nowOpen }));
    if (nowOpen && !loadedAnnotations[id]) {
      const res = await fetch(`/api/tracks/${id}`);
      if (!res.ok) return;
      const body = (await res.json()) as {
        ok: boolean;
        track: { annotations?: TrackAnnotation[] } | null;
      };
      setLoadedAnnotations((m) => ({ ...m, [id]: body.track?.annotations ?? [] }));
    }
  };

  const loadSlice = async (
    trackId: string,
    fromMs: number,
    toMs: number,
    fromLabel: string,
    toLabel: string,
  ): Promise<void> => {
    setOpenSlice({ trackId, fromMs, toMs, fromLabel, toLabel });
    setSliceData(null);
    const res = await fetch(`/api/tracks/${trackId}/slice?from=${fromMs}&to=${toMs}`);
    if (!res.ok) return;
    const body = (await res.json()) as SliceData;
    setSliceData(body);
  };

  const downloadSlice = (): void => {
    if (!sliceData || !openSlice) return;
    const blob = new Blob([JSON.stringify(sliceData, null, 2)], {
      type: 'application/json',
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${openSlice.trackId}-slice-${openSlice.fromMs}-${openSlice.toMs}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
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
              <span className="font-mono text-slate-200">{rec.activeTrackId ?? '—'}</span>
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
                  <Fragment key={t.id}>
                    <tr className="border-b border-slate-900">
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
                          <span className="text-slate-300">
                            {t.label || <span className="text-slate-600 italic">(no label)</span>}
                          </span>
                        )}
                      </td>
                      <td className="p-2 font-mono text-xs">{fmtUtc(t.startedAt)}</td>
                      <td className="p-2 font-mono text-xs">
                        {t.endedAt ? fmtUtc(t.endedAt) : '—'}
                      </td>
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
                    <tr key={`${t.id}-annotations`} className="border-b border-slate-900">
                      <td colSpan={9} className="px-2 pb-2">
                        <button
                          type="button"
                          onClick={() => void toggleExpand(t.id)}
                          className="text-xs text-slate-400 hover:text-slate-200 mt-1"
                        >
                          {expanded[t.id] ? '▼' : '▶'} Annotations
                        </button>
                        {expanded[t.id] && (
                          <div className="mt-2 pl-3 border-l border-slate-800 space-y-0.5">
                            {(loadedAnnotations[t.id] ?? []).length === 0 ? (
                              <div className="text-xs text-slate-500">No annotations.</div>
                            ) : (
                              (loadedAnnotations[t.id] ?? []).map((ann, idx, arr) => {
                                const icon =
                                  ann.kind === 'event'
                                    ? '●'
                                    : ann.kind === 'periodStart'
                                      ? '▶'
                                      : '■';
                                const iconColor =
                                  ann.kind === 'event'
                                    ? 'text-slate-400'
                                    : ann.kind === 'periodStart'
                                      ? 'text-emerald-400'
                                      : 'text-amber-400';
                                const relMs = ann.tsMs - new Date(t.startedAt).getTime();
                                const matchingEnd =
                                  ann.kind === 'periodStart'
                                    ? arr.slice(idx + 1).find((a) => a.kind === 'periodEnd')
                                    : null;
                                return (
                                  <div
                                    key={`${ann.tsMs}-${ann.label}`}
                                    title={fmtUtcMs(ann.tsMs)}
                                    className="flex items-baseline gap-2 text-xs py-0.5"
                                  >
                                    <span className="font-mono text-slate-500 shrink-0 w-16 text-right tabular-nums">
                                      +{fmtDurationMs(relMs)}
                                    </span>
                                    <span className={`shrink-0 ${iconColor}`}>{icon}</span>
                                    <span className="text-slate-200 flex-1 min-w-0 truncate">
                                      {ann.label}
                                    </span>
                                    {matchingEnd && (
                                      <button
                                        type="button"
                                        onClick={() =>
                                          void loadSlice(
                                            t.id,
                                            ann.tsMs,
                                            matchingEnd.tsMs,
                                            ann.label,
                                            matchingEnd.label,
                                          )
                                        }
                                        className="shrink-0 text-slate-400 hover:text-slate-200 underline"
                                      >
                                        slice · {fmtDurationMs(matchingEnd.tsMs - ann.tsMs)}
                                      </button>
                                    )}
                                    {ann.kind === 'periodStart' && !matchingEnd && (
                                      <span
                                        className="shrink-0 text-amber-400"
                                        title="Drop an End period to close this"
                                      >
                                        open
                                      </span>
                                    )}
                                  </div>
                                );
                              })
                            )}
                          </div>
                        )}
                      </td>
                    </tr>
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        )}
      </section>

      {openSlice && (
        <div className="fixed inset-0 z-30 bg-slate-950/80 flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-slate-700 rounded shadow-xl p-4 max-w-xl w-full space-y-3">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-semibold text-slate-100">
                Slice: {openSlice.fromLabel} → {openSlice.toLabel}
              </h2>
              <button
                type="button"
                onClick={() => setOpenSlice(null)}
                className="text-slate-400 hover:text-slate-200 text-xs"
              >
                ✕
              </button>
            </div>
            {sliceData === null ? (
              <div className="text-sm text-slate-400">Loading…</div>
            ) : (
              <>
                <div className="text-sm text-slate-300 space-y-1">
                  <div>
                    Duration:{' '}
                    <span className="font-mono">
                      {Math.round((openSlice.toMs - openSlice.fromMs) / 60_000)} min
                    </span>
                  </div>
                  <div>
                    Points: <span className="font-mono">{sliceData.points.length}</span>
                  </div>
                  <div>
                    Annotations in range:{' '}
                    <span className="font-mono">{sliceData.annotations.length}</span>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={downloadSlice}
                  className="w-full px-3 py-2 text-sm rounded bg-emerald-600 hover:bg-emerald-500 text-white"
                >
                  Download JSON
                </button>
              </>
            )}
          </div>
        </div>
      )}
    </main>
  );
}
