'use client';

import { useEffect, useState } from 'react';
import type { VictronSnapshot, EmporiaSnapshot } from '@g5000/core';
import { Panel } from '../../../components/ui/Panel';

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

/** Token class by fluid type. */
function tankBarClass(fluidType: string): string {
  const t = fluidType.toLowerCase();
  if (t.includes('fuel') || t.includes('diesel')) return 'bg-accent-hi';
  if (t.includes('waste') || t.includes('black') || t.includes('grey')) return 'bg-surface-raised';
  if (t.includes('gas') || t.includes('lpg')) return 'bg-warn';
  // Fresh water (default)
  return 'bg-info';
}

function TankCard({ tank }: { tank: TankInfo }): React.ReactElement {
  const pct = Math.round(tank.level * 100);
  const bar = tankBarClass(tank.fluidType);
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center justify-between text-xs">
        <span className="text-ink-3 truncate">{tank.fluidType}</span>
        <span className="text-ink tabular-nums font-mono ml-2">{pct}%</span>
      </div>
      <div className="h-2 rounded-full bg-surface-raised overflow-hidden">
        <div
          className={`h-full rounded-full ${bar} transition-all duration-500`}
          style={{ width: `${Math.max(0, Math.min(100, pct))}%` }}
        />
      </div>
      {tank.capacityL != null && (
        <span className="text-[0.611rem] text-ink-4 tabular-nums">
          {Math.round(tank.level * tank.capacityL)} / {Math.round(tank.capacityL)} L
        </span>
      )}
    </div>
  );
}

// ── Main panel ────────────────────────────────────────────────────────────────

export function SystemsPanel(): React.ReactElement {
  const [snapshot, setSnapshot] = useState<VictronSnapshot | null>(null);
  const [offline, setOffline] = useState(false);
  const [emporiaMainsW, setEmporiaMainsW] = useState<number | null>(null);

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

  useEffect(() => {
    let cancelled = false;

    const pollEmporia = async (): Promise<void> => {
      try {
        const r = await fetch('/api/emporia/state', { cache: 'no-store' });
        if (cancelled) return;
        if (!r.ok) return;
        const j = (await r.json()) as EmporiaSnapshot & { offline?: boolean };
        if (cancelled) return;
        setEmporiaMainsW(j.connected && !j.offline ? (j.mainsW ?? null) : null);
      } catch {
        /* upstream blip — next tick retries */
      }
    };

    void pollEmporia();
    const timer = setInterval(pollEmporia, POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, []);

  // ── Battery & Power card ───────────────────────────────────────────────────
  // The AC-loads row is independent of Victron: it shows whenever Emporia has
  // data, even when Victron is offline. We render the outer card always and
  // gate only the Victron-sourced content on `offline / snapshot === null`.

  if (offline || snapshot === null) {
    return (
      <Panel label="Battery &amp; Power">
        <div className="flex-1 flex items-center justify-center min-h-[48px]">
          <span className="text-ink-4 text-xs italic">Cerbo offline</span>
        </div>
        {/* AC-loads row visible even when Victron is offline */}
        {emporiaMainsW !== null && (
          <>
            <div className="border-t border-hairline my-2" />
            <div className="grid grid-cols-2 gap-x-4 gap-y-0.5 text-xs font-mono">
              <div className="flex items-center justify-between">
                <span className="text-ink-3">AC loads</span>
                <span className="text-ink tabular-nums">{fmtW(emporiaMainsW)}</span>
              </div>
            </div>
          </>
        )}
      </Panel>
    );
  }

  const bat = snapshot.battery;
  const isCharging = (bat.current ?? 0) >= 0;
  const signPrefix = isCharging ? '+' : '';
  const chargeLabel = isCharging ? 'CHARGING' : 'DISCHARGING';
  // ok token for charging; danger token for discharging
  const chargeClass = isCharging ? 'text-ok' : 'text-danger';

  return (
    <Panel label="Battery &amp; Power">
      <div className="flex flex-col gap-2">
        {/* SoC */}
        <div className="flex items-baseline gap-1">
          <span className="text-3xl font-semibold text-ink-value tabular-nums font-mono">
            {fmtNum(bat.soc, 0)}
          </span>
          <span className="text-xs text-ink-3">% SoC</span>
          {bat.timeToGoS != null && (
            <span className="ml-auto text-xs text-ink-3 tabular-nums">
              {fmtTimeToGo(bat.timeToGoS)} left
            </span>
          )}
        </div>

        {/* Charge / discharge row */}
        <div className={`flex items-center gap-1.5 text-xs font-mono font-semibold ${chargeClass}`}>
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
        <div className="border-t border-hairline" />

        {/* Quick power metrics */}
        <div className="grid grid-cols-2 gap-x-4 gap-y-0.5 text-xs font-mono">
          <div className="flex items-center justify-between">
            <span className="text-ink-3">Solar</span>
            <span className="text-accent-ink tabular-nums">{fmtW(snapshot.solar.totalPower)}</span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-ink-3">AC OUT</span>
            <span className="text-ink tabular-nums">{fmtW(snapshot.ac.outputPower)}</span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-ink-3">AC IN</span>
            <span className="text-ink tabular-nums">{fmtW(snapshot.ac.inputPower)}</span>
          </div>
          {/* AC loads row: always visible regardless of Victron state */}
          <div className="flex items-center justify-between">
            <span className="text-ink-3">AC loads</span>
            <span className="text-ink tabular-nums">{fmtW(emporiaMainsW)}</span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-ink-3">DC</span>
            <span className="text-ink tabular-nums">{fmtW(snapshot.dc.power)}</span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-ink-3">Batt</span>
            <span className="text-ink tabular-nums">{fmtNum(bat.voltage, 1)} V</span>
          </div>
          {bat.temperatureC != null && (
            <div className="flex items-center justify-between">
              <span className="text-ink-3">Bat °C</span>
              <span className="text-ink tabular-nums">{fmtNum(bat.temperatureC, 1)} °C</span>
            </div>
          )}
        </div>

        {/* Tanks ─────────────────────────────────────────────────────────────── */}
        {snapshot.tanks.length > 0 && (
          <>
            <div className="border-t border-hairline" />
            <span className="text-[0.611rem] uppercase tracking-wide text-ink-4">Tanks</span>
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
            <div className="border-t border-hairline" />
            <span className="text-[0.611rem] uppercase tracking-wide text-ink-4">Temperatures</span>
            <div className="flex flex-col gap-0.5">
              {snapshot.temperatures.map((t) => (
                <div key={t.id} className="flex items-center justify-between text-xs font-mono">
                  <span className="text-ink-3 truncate">{t.name}</span>
                  <span className="text-ink tabular-nums ml-2">{fmtNum(t.celsius, 1)} °C</span>
                </div>
              ))}
            </div>
          </>
        )}
      </div>
    </Panel>
  );
}
