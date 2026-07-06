'use client';

// AcLoadsTab — live per-circuit AC load view from /api/emporia/state.
// Polls every 2 s; shows offline state (not zeros) when Emporia is unavailable.
// Flat sorted list; L1/L2/240V grouping comes in a later task.

import { useEffect, useState } from 'react';
import type { EmporiaSnapshot, EmporiaCircuit } from '@g5000/core';

const POLL_MS = 2_000;

// ── Formatters ────────────────────────────────────────────────────────────────

function fmtW(v: number | null | undefined): string {
  if (v == null || !isFinite(v)) return '—';
  return `${Math.round(v)} W`;
}

function fmtTime(epochMs: number): string {
  try {
    return new Date(epochMs).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  } catch {
    return '—';
  }
}

// ── Circuit row ───────────────────────────────────────────────────────────────

function CircuitRow({
  name,
  watts,
  maxW,
}: {
  name: string;
  watts: number | null;
  maxW: number;
}): React.ReactElement {
  const pct =
    watts != null && maxW > 0 ? Math.min(100, Math.round((Math.max(0, watts) / maxW) * 100)) : 0;

  return (
    <div className="flex flex-col gap-0.5">
      <div className="flex items-center justify-between text-xs">
        <span className="text-slate-400 truncate">{name}</span>
        <span className="text-slate-200 tabular-nums font-mono ml-2">{fmtW(watts)}</span>
      </div>
      <div className="h-1.5 rounded-full bg-slate-800 overflow-hidden">
        <div
          className="h-full rounded-full bg-sky-500 transition-all duration-500"
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}

// ── Main tab ──────────────────────────────────────────────────────────────────

export function AcLoadsTab(): React.ReactElement {
  const [snapshot, setSnapshot] = useState<(EmporiaSnapshot & { offline?: boolean }) | null>(null);
  const [lastKnownAt, setLastKnownAt] = useState<number | null>(null);
  const [offline, setOffline] = useState(false);

  useEffect(() => {
    let cancelled = false;

    const poll = async (): Promise<void> => {
      try {
        const r = await fetch('/api/emporia/state', { cache: 'no-store' });
        if (cancelled) return;
        if (!r.ok) return;
        const j = (await r.json()) as EmporiaSnapshot & { offline?: boolean };
        if (cancelled) return;
        if (!j.connected || j.offline) {
          setOffline(true);
          // Keep last-known timestamp if the snapshot had one before going offline.
          if (j.updatedAt && j.updatedAt > 0) setLastKnownAt(j.updatedAt);
        } else {
          setOffline(false);
          setLastKnownAt(j.updatedAt);
          setSnapshot(j);
        }
      } catch {
        /* upstream blip — next tick retries */
      }
    };

    void poll();
    const timer = setInterval(poll, POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, []);

  // Offline / loading state — never show zeros.
  if (offline || snapshot === null) {
    return (
      <div className="flex flex-col gap-1">
        <p className="text-slate-500 text-xs italic">Emporia not configured / offline</p>
        {lastKnownAt != null && lastKnownAt > 0 && (
          <p className="text-slate-600 text-[10px]">Last known: {fmtTime(lastKnownAt)}</p>
        )}
      </div>
    );
  }

  // Sort circuits by watts desc (nulls last).
  const sorted: EmporiaCircuit[] = [...snapshot.circuits].sort((a, b) => {
    if (a.watts == null && b.watts == null) return 0;
    if (a.watts == null) return 1;
    if (b.watts == null) return -1;
    return b.watts - a.watts;
  });

  // Max watts across circuits (used for bar scaling; exclude balance/mains here).
  const circuitWatts = sorted.map((c) => c.watts ?? 0);
  const maxCircuitW = Math.max(0, ...circuitWatts);

  // Also include balanceW in max for consistent bar scale.
  const maxW = Math.max(maxCircuitW, snapshot.balanceW ?? 0);

  return (
    <div className="flex flex-col gap-3">
      {/* Total mains header */}
      <div className="flex items-baseline gap-2">
        <span className="text-2xl font-semibold font-mono text-sky-300 tabular-nums">
          {snapshot.mainsW != null ? Math.round(snapshot.mainsW) : '—'}
        </span>
        <span className="text-xs text-slate-400">W total AC</span>
      </div>

      {/* Per-circuit rows */}
      {sorted.length === 0 && (snapshot.balanceW == null || snapshot.balanceW === 0) ? (
        <p className="text-slate-600 text-xs italic">No circuits reported</p>
      ) : (
        <div className="flex flex-col gap-2">
          {sorted.map((c) => (
            <CircuitRow key={c.channelNum} name={c.name} watts={c.watts} maxW={maxW} />
          ))}

          {/* Balance row — "Everything else" */}
          {snapshot.balanceW != null && (
            <CircuitRow name="Everything else" watts={snapshot.balanceW} maxW={maxW} />
          )}
        </div>
      )}
    </div>
  );
}
