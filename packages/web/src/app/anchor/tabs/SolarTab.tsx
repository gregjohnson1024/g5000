'use client';

// SolarTab — per-charger cards + system total from /api/victron/state.
// No per-charger history channel exists yet, so curves are omitted;
// a number/bar layout is used instead.

import { useEffect, useState } from 'react';
import type { VictronSnapshot, VictronCharger } from '@g5000/core';

const POLL_MS = 2_000;

// ── Formatters ────────────────────────────────────────────────────────────────

function fmtNum(v: number | null | undefined, decimals = 0): string {
  if (v == null || !isFinite(v)) return '—';
  return v.toFixed(decimals);
}

function fmtW(v: number | null | undefined): string {
  if (v == null || !isFinite(v)) return '—';
  return `${Math.round(v)} W`;
}

// ── Charger card ─────────────────────────────────────────────────────────────

function ChargerCard({ charger }: { charger: VictronCharger }): React.ReactElement {
  // Bar fill based on power relative to dayMaxPower (or 600 W fallback).
  const maxW = charger.dayMaxPower > 0 ? charger.dayMaxPower : 600;
  const pct = Math.min(100, Math.round((Math.max(0, charger.power) / maxW) * 100));

  return (
    <div className="bg-surface-raised [border-radius:var(--r-panel)] p-2.5 flex flex-col gap-1.5">
      {/* Name + state */}
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs text-ink font-medium truncate">{charger.name}</span>
        <span className="text-[0.611rem] text-accent-ink uppercase tracking-wide shrink-0">
          {charger.state}
        </span>
      </div>

      {/* Power bar */}
      <div className="h-1.5 rounded-full bg-surface overflow-hidden">
        <div
          className="h-full rounded-full bg-accent-hi transition-all duration-500"
          style={{ width: `${pct}%` }}
        />
      </div>

      {/* Metrics row */}
      <div className="grid grid-cols-3 gap-1 text-[0.611rem] font-mono">
        <div className="flex flex-col items-center">
          <span className="text-accent-ink font-semibold tabular-nums">{fmtW(charger.power)}</span>
          <span className="text-ink-4 text-[0.556rem] uppercase">Now</span>
        </div>
        <div className="flex flex-col items-center">
          <span className="text-ink-2 tabular-nums">{fmtNum(charger.voltage, 1)} V</span>
          <span className="text-ink-4 text-[0.556rem] uppercase">Volt</span>
        </div>
        <div className="flex flex-col items-center">
          <span className="text-ink-2 tabular-nums">{fmtNum(charger.current, 1)} A</span>
          <span className="text-ink-4 text-[0.556rem] uppercase">Amp</span>
        </div>
      </div>

      {/* Day stats */}
      <div className="flex items-center justify-between text-[0.611rem] font-mono text-ink-3">
        <span>
          Day max <span className="text-ink-2">{fmtW(charger.dayMaxPower)}</span>
        </span>
        <span>
          Today <span className="text-ink-2">{fmtNum(charger.yieldTodayKwh, 3)} kWh</span>
        </span>
      </div>
    </div>
  );
}

// ── Main tab ──────────────────────────────────────────────────────────────────

export function SolarTab(): React.ReactElement {
  const [snapshot, setSnapshot] = useState<VictronSnapshot | null>(null);
  const [offline, setOffline] = useState(false);

  useEffect(() => {
    let cancelled = false;

    const poll = async (): Promise<void> => {
      try {
        const r = await fetch('/api/victron/state', { cache: 'no-store' });
        if (cancelled) return;
        if (!r.ok) return;
        const j = (await r.json()) as VictronSnapshot & { offline?: boolean };
        if (cancelled) return;
        if (!j.connected || j.offline) {
          setOffline(true);
          setSnapshot(null);
        } else {
          setOffline(false);
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

  if (offline || snapshot === null) {
    return <p className="text-ink-4 text-xs italic">{offline ? 'Cerbo offline' : 'Loading…'}</p>;
  }

  const { solar } = snapshot;
  const chargers = solar.chargers ?? [];

  return (
    <div className="flex flex-col gap-3">
      {/* System total */}
      <div className="flex items-baseline gap-2">
        <span className="text-2xl font-semibold font-mono text-accent-ink tabular-nums">
          {solar.totalPower != null ? Math.round(solar.totalPower) : '—'}
        </span>
        <span className="text-xs text-ink-3">W total solar</span>
      </div>

      {/* Per-charger cards */}
      {chargers.length === 0 ? (
        <p className="text-ink-4 text-xs italic">No MPPT chargers reported</p>
      ) : (
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          {chargers.map((c) => (
            <ChargerCard key={c.id} charger={c} />
          ))}
        </div>
      )}
    </div>
  );
}
