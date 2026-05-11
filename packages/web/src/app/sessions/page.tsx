'use client';

import { useEffect, useState, useCallback } from 'react';

interface SessionInfo {
  id: string;
  sizeBytes: number;
  mtime: string;
  startedAt?: string;
}

interface SessionSummary extends SessionInfo {
  canLines: number;
  otLines: number;
  durationMs: number;
}

interface ReplayStatus {
  mode: 'live' | 'demo' | 'replay';
  sessionId?: string;
  paceMode?: 'realtime' | 'asap';
  phase?: 'running' | 'finished' | 'error';
  errorMessage?: string;
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

function formatDuration(ms: number): string {
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s} s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ${s % 60}s`;
  return `${Math.floor(m / 60)}h ${m % 60}m`;
}

export default function SessionsPage() {
  const [sessions, setSessions] = useState<SessionInfo[]>([]);
  const [summaries, setSummaries] = useState<Record<string, SessionSummary>>({});
  const [status, setStatus] = useState<ReplayStatus>({ mode: 'live' });
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const r = await fetch('/api/sessions');
    if (!r.ok) return;
    const j = (await r.json()) as { sessions: SessionInfo[] };
    setSessions(j.sessions);
  }, []);

  const pollStatus = useCallback(async () => {
    const r = await fetch('/api/source-mode');
    if (!r.ok) return;
    const j = (await r.json()) as ReplayStatus;
    setStatus(j);
  }, []);

  useEffect(() => {
    void refresh();
    void pollStatus();
    const id = setInterval(pollStatus, 1000);
    return () => clearInterval(id);
  }, [refresh, pollStatus]);

  const summarise = useCallback(async (sessionId: string) => {
    const r = await fetch(`/api/sessions/${encodeURIComponent(sessionId)}`);
    if (!r.ok) return;
    const s = (await r.json()) as SessionSummary;
    setSummaries((prev) => ({ ...prev, [sessionId]: s }));
  }, []);

  const startReplay = useCallback(
    async (sessionId: string, paceMode: 'realtime' | 'asap') => {
      setErrorMessage(null);
      const r = await fetch('/api/replay/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId, paceMode }),
      });
      if (!r.ok) {
        const j = (await r.json().catch(() => ({}))) as { error?: string };
        setErrorMessage(j.error ?? `HTTP ${r.status}`);
      }
      await pollStatus();
    },
    [pollStatus],
  );

  const stopReplay = useCallback(async () => {
    await fetch('/api/replay/stop', { method: 'POST' });
    await pollStatus();
  }, [pollStatus]);

  const deleteSession = useCallback(
    async (sessionId: string) => {
      if (!confirm(`Delete session "${sessionId}"?`)) return;
      await fetch(`/api/sessions/${encodeURIComponent(sessionId)}`, { method: 'DELETE' });
      await refresh();
    },
    [refresh],
  );

  const replaying = status.mode === 'replay';

  return (
    <main className="p-6 max-w-6xl mx-auto text-slate-100">
      <h1 className="text-2xl font-semibold mb-4">Sessions</h1>

      <div
        className={`mb-6 p-3 rounded font-mono text-sm ${
          status.mode === 'live'
            ? 'bg-emerald-900/40 border border-emerald-800'
            : status.mode === 'demo'
              ? 'bg-amber-900/40 border border-amber-800'
              : 'bg-purple-900/40 border border-purple-800'
        }`}
      >
        Source mode: <b className="uppercase">{status.mode}</b>
        {replaying && (
          <>
            {' — '}replaying <code>{status.sessionId}</code> ({status.paceMode}){' — '}
            <button
              type="button"
              onClick={stopReplay}
              className="ml-2 px-2 py-0.5 rounded bg-slate-200 text-slate-900 font-medium hover:bg-slate-100"
            >
              Stop
            </button>
          </>
        )}
      </div>

      {errorMessage && (
        <div className="mb-4 p-2 bg-red-900/40 border border-red-700 rounded text-sm text-red-200">
          {errorMessage}
        </div>
      )}

      <table className="w-full text-sm font-mono border-collapse">
        <thead>
          <tr className="text-slate-400 border-b border-slate-700">
            <th className="text-left py-2 pr-3">Session ID</th>
            <th className="text-left py-2 pr-3">Started</th>
            <th className="text-right py-2 pr-3">Size</th>
            <th className="text-right py-2 pr-3">Samples</th>
            <th className="text-right py-2 pr-3">Duration</th>
            <th className="text-right py-2">Actions</th>
          </tr>
        </thead>
        <tbody>
          {sessions.length === 0 && (
            <tr>
              <td colSpan={6} className="py-6 text-center text-slate-500">
                No sessions yet. Run the server with{' '}
                <code>SESSION_LOG_DIR=./data/sessions</code> to start recording.
              </td>
            </tr>
          )}
          {sessions.map((s) => {
            const summary = summaries[s.id];
            return (
              <tr
                key={s.id}
                className="border-b border-slate-800 hover:bg-slate-900/40"
                onMouseEnter={() => {
                  if (!summary) void summarise(s.id);
                }}
              >
                <td className="py-2 pr-3">{s.id}</td>
                <td className="py-2 pr-3 text-slate-300">
                  {s.startedAt ?? s.mtime.slice(0, 19).replace('T', ' ')}
                </td>
                <td className="py-2 pr-3 text-right">{formatBytes(s.sizeBytes)}</td>
                <td className="py-2 pr-3 text-right text-slate-300">
                  {summary ? `${summary.canLines} can / ${summary.otLines} 0183` : '…'}
                </td>
                <td className="py-2 pr-3 text-right text-slate-300">
                  {summary ? formatDuration(summary.durationMs) : '…'}
                </td>
                <td className="py-2 text-right space-x-1">
                  <a
                    href={`/api/sessions/${encodeURIComponent(s.id)}/download`}
                    className="px-2 py-1 rounded bg-slate-700 hover:bg-slate-600 text-xs"
                  >
                    Download
                  </a>
                  <button
                    type="button"
                    disabled={replaying}
                    onClick={() => startReplay(s.id, 'realtime')}
                    className="px-2 py-1 rounded bg-emerald-700 hover:bg-emerald-600 text-xs disabled:opacity-40"
                  >
                    Replay 1×
                  </button>
                  <button
                    type="button"
                    disabled={replaying}
                    onClick={() => startReplay(s.id, 'asap')}
                    className="px-2 py-1 rounded bg-emerald-900 hover:bg-emerald-800 text-xs disabled:opacity-40"
                  >
                    Replay fast
                  </button>
                  <button
                    type="button"
                    disabled={replaying}
                    onClick={() => deleteSession(s.id)}
                    className="px-2 py-1 rounded bg-red-900 hover:bg-red-800 text-xs disabled:opacity-40"
                  >
                    Delete
                  </button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </main>
  );
}
