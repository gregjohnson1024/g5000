'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { LogEntry, LogLevel } from '@g5000/core';

const MAX_BUFFER = 500;

const LEVEL_CHIP: Record<LogLevel, string> = {
  info: 'bg-slate-700 text-slate-100',
  warn: 'bg-amber-700 text-amber-100',
  error: 'bg-red-700 text-red-100',
};

type ConnState = 'connecting' | 'connected' | 'reconnecting';

function formatTimestamp(t: number): string {
  const d = new Date(t);
  const hh = d.getHours().toString().padStart(2, '0');
  const mm = d.getMinutes().toString().padStart(2, '0');
  const ss = d.getSeconds().toString().padStart(2, '0');
  const ms = d.getMilliseconds().toString().padStart(3, '0');
  return `${hh}:${mm}:${ss}.${ms}`;
}

export default function LogsPage() {
  const [entries, setEntries] = useState<LogEntry[]>([]);
  const [conn, setConn] = useState<ConnState>('connecting');
  const [autoScroll, setAutoScroll] = useState(true);
  const [levels, setLevels] = useState<Record<LogLevel, boolean>>({
    info: true,
    warn: true,
    error: true,
  });
  const scrollRef = useRef<HTMLDivElement | null>(null);
  // Keep autoScroll in a ref so the EventSource callback always reads the
  // current value without us re-binding the source on every toggle.
  const autoScrollRef = useRef(autoScroll);
  autoScrollRef.current = autoScroll;

  useEffect(() => {
    const es = new EventSource('/api/logs/stream');
    es.onopen = () => setConn('connected');
    es.onerror = () => setConn('reconnecting');
    es.onmessage = (ev) => {
      try {
        const entry = JSON.parse(ev.data) as LogEntry;
        setEntries((prev) => {
          if (prev.length < MAX_BUFFER) return [...prev, entry];
          return [...prev.slice(prev.length - MAX_BUFFER + 1), entry];
        });
      } catch {
        /* ignore malformed payloads */
      }
    };
    return () => es.close();
  }, []);

  // Auto-scroll on new entries when the toggle is on.
  useEffect(() => {
    if (!autoScrollRef.current) return;
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [entries]);

  const toggleLevel = useCallback((level: LogLevel) => {
    setLevels((prev) => ({ ...prev, [level]: !prev[level] }));
  }, []);

  const visible = entries.filter((e) => levels[e.level]);

  return (
    <main className="p-6 flex flex-col h-[calc(100vh-3rem)]">
      <div className="flex items-center gap-3 mb-3 flex-wrap">
        <h1 className="text-2xl font-semibold">Server logs</h1>
        <span className="text-xs text-slate-400 font-mono">
          {conn === 'connected'
            ? `Connected · ${entries.length} entries (${visible.length} shown)`
            : conn === 'reconnecting'
              ? 'Reconnecting…'
              : 'Connecting…'}
        </span>
        <div className="ml-auto flex items-center gap-2">
          {(['info', 'warn', 'error'] as LogLevel[]).map((lvl) => (
            <button
              key={lvl}
              type="button"
              onClick={() => toggleLevel(lvl)}
              className={`px-2 py-1 rounded text-xs font-mono uppercase ${
                levels[lvl]
                  ? LEVEL_CHIP[lvl]
                  : 'bg-slate-900 text-slate-500 line-through'
              }`}
              title={`Toggle ${lvl} lines`}
            >
              {lvl}
            </button>
          ))}
          <button
            type="button"
            onClick={() => setAutoScroll((v) => !v)}
            className={`px-2 py-1 rounded text-xs font-mono ${
              autoScroll
                ? 'bg-emerald-700 text-emerald-100'
                : 'bg-slate-800 text-slate-300'
            }`}
            title="Pause/resume auto-scroll"
          >
            Auto-scroll: {autoScroll ? 'on' : 'off'}
          </button>
          <button
            type="button"
            onClick={() => setEntries([])}
            className="px-2 py-1 rounded text-xs font-mono bg-slate-800 text-slate-300 hover:bg-slate-700"
            title="Clear the client-side buffer (server buffer is unaffected)"
          >
            Clear
          </button>
        </div>
      </div>
      <div
        ref={scrollRef}
        className="flex-1 overflow-y-auto bg-slate-950 border border-slate-800 rounded p-2 text-xs font-mono leading-relaxed"
      >
        {visible.length === 0 ? (
          <div className="text-slate-500 p-2">
            {entries.length === 0
              ? 'Waiting for log lines…'
              : 'All entries filtered out — re-enable a level above.'}
          </div>
        ) : (
          visible.map((e, i) => (
            <div key={`${e.t}-${i}`} className="flex gap-2 items-start py-0.5">
              <span className="text-slate-500 shrink-0">{formatTimestamp(e.t)}</span>
              <span
                className={`shrink-0 px-1 rounded text-[10px] uppercase ${LEVEL_CHIP[e.level]}`}
              >
                {e.level}
              </span>
              <span className="text-slate-100 whitespace-pre-wrap break-all">
                {e.message}
              </span>
            </div>
          ))
        )}
      </div>
    </main>
  );
}
