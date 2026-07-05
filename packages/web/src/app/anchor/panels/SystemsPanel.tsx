'use client';

import { useEffect, useState } from 'react';
import type { VictronSnapshot } from '@g5000/core';

const POLL_MS = 2_000;

// ── Formatters ────────────────────────────────────────────────────────────────

/** Format seconds as "9h 46m" (or "—" when null). */
function fmtTimeToGo(seconds: number | null): string {
  if (seconds === null) return '—';
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

/** Format a possibly-null number with fixed decimals (or "—"). */
function fmtNum(v: number | null | undefined, decimals = 0): string {
  if (v == null || !isFinite(v)) return '—';
  return v.toFixed(decimals);
}

/** Format watts, or "—". */
function fmtW(v: number | null | undefined): string {
  if (v == null || !isFinite(v)) return '—';
  return `${Math.round(v)} W`;
}

// ── Tank sub-card ────────────────────────────────────────────────────────────

type TankInfo = VictronSnapshot['tanks'][number];

/** Colour by fluid type. */
function tankBarColour(fluidType: string): string {
  const t = fluidType.toLowerCase();
  if (t.includes('fuel') || t.includes('diesel')) return 'bg-amber-500';
  if (t.includes('waste') || t.includes('black') || t.includes('grey')) return 'bg-slate-500';
  if (t.includes('gas') || t.includes('lpg')) return 'bg-orange-400';
  // Fresh water (default)
  return 'bg-sky-500';
}

function TankCard({ tank }: { tank: TankInfo }): React.ReactElement {
  const pct = Math.round(tank.level * 100);
  const bar = tankBarColour(tank.fluidType);
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center justify-between text-xs">
        <span className="text-slate-400 truncate">{tank.fluidType}</span>
        <span className="text-slate-200 tabular-nums font-mono ml-2">{pct}%</span>
      </div>
      <div className="h-2 rounded-full bg-slate-800 overflow-hidden">
        <div
          className={`h-full rounded-full ${bar} transition-all duration-500`}
          style={{ width: `${Math.max(0, Math.min(100, pct))}%` }}
        />
      </div>
      {tank.capacityL != null && (
        <span className="text-[10px] text-slate-600 tabular-nums">
          {Math.round(tank.level * tank.capacityL)} / {Math.round(tank.capacityL)} L
        </span>
      )}
    </div>
  );
}

// ── Offline state ─────────────────────────────────────────────────────────────

function OfflineCard({ label }: { label: string }): React.ReactElement {
  return (
    <div className="bg-slate-900 border border-slate-800 rounded-lg p-3 flex flex-col gap-1 min-h-[100px]">
      <span className="text-xs uppercase tracking-wide text-slate-500 font-medium">{label}</span>
      <div className="flex-1 flex items-center justify-center">
        <span className="text-slate-600 text-xs italic">Cerbo offline</span>
      </div>
    </div>
  );
}

// ── Main panel ────────────────────────────────────────────────────────────────

export function SystemsPanel(): React.ReactElement {
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

  // ── Battery & Power card ───────────────────────────────────────────────────
  if (offline || snapshot === null) {
    // Show offline for all three conceptual sections as a single card.
    return <OfflineCard label="Battery & Power" />;
  }

  const bat = snapshot.battery;
  const isCharging = (bat.current ?? 0) >= 0;
  const signPrefix = isCharging ? '+' : '';
  const chargeLabel = isCharging ? 'CHARGING' : 'DISCHARGING';
  const chargeColour = isCharging ? 'text-emerald-400' : 'text-rose-400';

  return (
    <div className="bg-slate-900 border border-slate-800 rounded-lg p-3 flex flex-col gap-2 min-h-[100px]">
      {/* Header */}
      <span className="text-xs uppercase tracking-wide text-slate-500 font-medium">
        Battery &amp; Power
      </span>

      {/* SoC */}
      <div className="flex items-baseline gap-1">
        <span className="text-3xl font-semibold text-slate-100 tabular-nums font-mono">
          {fmtNum(bat.soc, 0)}
        </span>
        <span className="text-xs text-slate-400">% SoC</span>
        {bat.timeToGoS != null && (
          <span className="ml-auto text-xs text-slate-400 tabular-nums">
            {fmtTimeToGo(bat.timeToGoS)} left
          </span>
        )}
      </div>

      {/* Charge / discharge row */}
      <div className={`flex items-center gap-1.5 text-xs font-mono font-semibold ${chargeColour}`}>
        <span>{chargeLabel}</span>
        <span>
          {signPrefix}
          {fmtNum(bat.current, 1)} A
        </span>
        <span>
          {signPrefix}
          {fmtNum(bat.power, 0)} W
        </span>
      </div>

      {/* Divider */}
      <div className="border-t border-slate-800" />

      {/* Quick power metrics */}
      <div className="grid grid-cols-2 gap-x-4 gap-y-0.5 text-xs font-mono">
        <div className="flex items-center justify-between">
          <span className="text-slate-500">Solar</span>
          <span className="text-amber-300 tabular-nums">{fmtW(snapshot.solar.totalPower)}</span>
        </div>
        <div className="flex items-center justify-between">
          <span className="text-slate-500">AC OUT</span>
          <span className="text-slate-200 tabular-nums">{fmtW(snapshot.ac.outputPower)}</span>
        </div>
        <div className="flex items-center justify-between">
          <span className="text-slate-500">AC IN</span>
          <span className="text-slate-200 tabular-nums">{fmtW(snapshot.ac.inputPower)}</span>
        </div>
        <div className="flex items-center justify-between">
          <span className="text-slate-500">DC</span>
          <span className="text-slate-200 tabular-nums">{fmtW(snapshot.dc.power)}</span>
        </div>
        <div className="flex items-center justify-between">
          <span className="text-slate-500">Batt</span>
          <span className="text-slate-200 tabular-nums">{fmtNum(bat.voltage, 1)} V</span>
        </div>
        {bat.temperatureC != null && (
          <div className="flex items-center justify-between">
            <span className="text-slate-500">Bat °C</span>
            <span className="text-slate-200 tabular-nums">{fmtNum(bat.temperatureC, 1)} °C</span>
          </div>
        )}
      </div>

      {/* Tanks ─────────────────────────────────────────────────────────────── */}
      {snapshot.tanks.length > 0 && (
        <>
          <div className="border-t border-slate-800" />
          <span className="text-[10px] uppercase tracking-wide text-slate-600">Tanks</span>
          <div className="flex flex-col gap-2">
            {snapshot.tanks.map((tank) => (
              <TankCard key={tank.id} tank={tank} />
            ))}
          </div>
        </>
      )}

      {/* Temperatures ────────────────────────────────────────────────────── */}
      {snapshot.temperatures.length > 0 && (
        <>
          <div className="border-t border-slate-800" />
          <span className="text-[10px] uppercase tracking-wide text-slate-600">Temperatures</span>
          <div className="flex flex-col gap-0.5">
            {snapshot.temperatures.map((t) => (
              <div key={t.id} className="flex items-center justify-between text-xs font-mono">
                <span className="text-slate-400 truncate">{t.name}</span>
                <span className="text-slate-200 tabular-nums ml-2">{fmtNum(t.celsius, 1)} °C</span>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
