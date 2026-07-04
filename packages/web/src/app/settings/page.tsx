'use client';
import { useEffect, useState } from 'react';
import { SatelliteCachePanel } from './SatelliteCachePanel';
import { PLANNING_DEFAULTS, type PlanningSettings } from '../../lib/planning-settings';

type SourceMode = 'live' | 'demo' | 'replay';
interface SourceModeStatus {
  mode: SourceMode;
  sessionId?: string;
  paceMode?: 'realtime' | 'asap';
  phase?: 'running' | 'finished' | 'error';
  startedAt?: string;
  errorMessage?: string;
}

// A fresh, mutable copy of the engine defaults. Used both for initial state and
// the Reset button so the two never drift apart.
function freshDefaults(): Required<PlanningSettings> {
  return {
    stepMinutes: PLANNING_DEFAULTS.stepMinutes,
    pruneBucketDeg: PLANNING_DEFAULTS.pruneBucketDeg,
    headingFanDeg: PLANNING_DEFAULTS.headingFanDeg,
    headingResolutionDeg: PLANNING_DEFAULTS.headingResolutionDeg,
    maxHours: PLANNING_DEFAULTS.maxHours,
    avoidLand: PLANNING_DEFAULTS.avoidLand,
    autoMotor: { ...PLANNING_DEFAULTS.autoMotor },
  };
}

function PlanningSection() {
  const [p, setP] = useState<Required<PlanningSettings>>(freshDefaults);
  const [status, setStatus] = useState<string | null>(null);

  useEffect(() => {
    void fetch('/api/settings')
      .then((r) => r.json())
      .then((j) => {
        if (j.ok && j.settings?.planning) {
          setP((prev) => ({
            ...prev,
            ...j.settings.planning,
            autoMotor: { ...prev.autoMotor, ...(j.settings.planning.autoMotor ?? {}) },
          }));
        }
      })
      .catch(() => {});
  }, []);

  const save = async () => {
    setStatus('Saving…');
    const cur = await fetch('/api/settings')
      .then((r) => r.json())
      .catch(() => ({ settings: {} }));
    const merged = { ...(cur.settings ?? {}), planning: p };
    const res = await fetch('/api/settings', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(merged),
    });
    setStatus(res.ok ? 'Saved' : 'Save failed');
    setTimeout(() => setStatus(null), 2500);
  };

  const num = (label: string, hint: string, key: keyof PlanningSettings, step = 1, min = 0) => (
    <label className="block text-sm">
      {label}
      <input
        type="number"
        min={min}
        step={step}
        value={p[key] as number}
        onChange={(e) => setP((s) => ({ ...s, [key]: Number(e.target.value) }))}
        className="bg-slate-900 border border-slate-700 rounded px-2 py-1 w-28 ml-2"
      />
      <span className="block text-[11px] text-slate-500">{hint}</span>
    </label>
  );

  return (
    <section className="space-y-3 border border-slate-800 rounded p-3">
      <h2 className="text-lg font-semibold">Planning</h2>
      {num(
        'Frontier size (°)',
        'Smaller = denser frontier, slower but finer.',
        'pruneBucketDeg',
        0.5,
        0.5,
      )}
      {num(
        'Isochrone length (min)',
        'Time between isochrones / planner step.',
        'stepMinutes',
        5,
        5,
      )}
      {num(
        'Heading fan (±°)',
        'Search width around bearing-to-destination.',
        'headingFanDeg',
        5,
        5,
      )}
      {num('Heading resolution (°)', 'Headings tried per fan.', 'headingResolutionDeg', 1, 1)}
      {num('Max hours', 'Planning horizon cap.', 'maxHours', 12, 12)}
      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={p.avoidLand}
          onChange={(e) => setP((s) => ({ ...s, avoidLand: e.target.checked }))}
        />
        Avoid land (uncheck to skip the land check on open-ocean routes — faster)
      </label>
      <fieldset className="border border-slate-800 rounded p-2 space-y-1">
        <legend className="text-sm px-1">Auto-motor</legend>
        <div className="text-sm">
          motor when slower than
          <input
            type="number"
            min={0}
            step={0.5}
            value={p.autoMotor.minSailKt}
            onChange={(e) =>
              setP((s) => ({
                ...s,
                autoMotor: { ...s.autoMotor, minSailKt: Number(e.target.value) },
              }))
            }
            className="bg-slate-900 border border-slate-700 rounded px-2 py-1 w-16 mx-1"
          />{' '}
          kn, at
          <input
            type="number"
            min={0}
            step={0.5}
            value={p.autoMotor.motorKt}
            onChange={(e) =>
              setP((s) => ({
                ...s,
                autoMotor: { ...s.autoMotor, motorKt: Number(e.target.value) },
              }))
            }
            className="bg-slate-900 border border-slate-700 rounded px-2 py-1 w-16 mx-1"
          />{' '}
          kn
        </div>
        <p className="text-[11px] text-slate-500">0 kn threshold = never motor. Set high to always motor.</p>
      </fieldset>
      <div className="flex items-center gap-3">
        <button onClick={save} className="bg-emerald-700 px-3 py-1 rounded text-sm">
          Save planning
        </button>
        <button
          onClick={() => setP(freshDefaults())}
          className="bg-slate-700 px-3 py-1 rounded text-sm"
        >
          Reset to defaults
        </button>
        {status && <span className="text-sm text-slate-400">{status}</span>}
      </div>
    </section>
  );
}

export default function SettingsPage() {
  // Source-mode state — separate from the persisted settings above because
  // it's a runtime-only switch (lives in the SourceModeController, not
  // settings.json). Polled so the UI reflects any out-of-band switch.
  const [sourceMode, setSourceMode] = useState<SourceModeStatus | null>(null);
  const [sourceModeBusy, setSourceModeBusy] = useState<boolean>(false);
  const [sourceModeError, setSourceModeError] = useState<string | undefined>();

  // SocketCAN (PiCAN-M) config. Hot-applied via /api/socketcan — the
  // POST both persists and toggles the live DriverHub, so the UI shows
  // immediate feedback. Polled so an out-of-band change (curl, restart
  // applying a stale settings.json, etc.) reflects here.
  const [socketCanEnabled, setSocketCanEnabled] = useState<boolean>(false);
  const [socketCanInterface, setSocketCanInterface] = useState<string>('can0');
  const [socketCanRunning, setSocketCanRunning] = useState<boolean>(false);
  const [socketCanBusy, setSocketCanBusy] = useState<boolean>(false);
  const [socketCanError, setSocketCanError] = useState<string | undefined>();

  // Poll source mode so the radio reflects out-of-band switches (e.g.,
  // someone hit /api/source-mode from curl or another tab).
  useEffect(() => {
    let cancelled = false;
    const tick = async (): Promise<void> => {
      try {
        const res = await fetch('/api/source-mode', { cache: 'no-store' });
        const j = (await res.json()) as SourceModeStatus | { error: string };
        if (cancelled) return;
        if ('error' in j) setSourceModeError(j.error);
        else {
          setSourceMode(j);
          setSourceModeError(undefined);
        }
      } catch (e) {
        if (!cancelled) setSourceModeError(String(e));
      }
    };
    void tick();
    const id = setInterval(tick, 5000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, []);

  // Poll SocketCAN state so the UI reflects the live DriverHub plus the
  // persisted settings flag — these can diverge briefly if the driver
  // failed to start (persisted: enabled=true, running=false).
  useEffect(() => {
    let cancelled = false;
    const tick = async (): Promise<void> => {
      try {
        const res = await fetch('/api/socketcan', { cache: 'no-store' });
        const j = (await res.json()) as
          | {
              ok: true;
              state: { enabled: boolean; interface: string; running: boolean };
            }
          | { ok: false; error?: { message?: string } };
        if (cancelled) return;
        if (j.ok) {
          setSocketCanEnabled(j.state.enabled);
          setSocketCanInterface(j.state.interface);
          setSocketCanRunning(j.state.running);
          setSocketCanError(undefined);
        }
      } catch (e) {
        if (!cancelled) setSocketCanError(String(e));
      }
    };
    void tick();
    const id = setInterval(tick, 5000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, []);

  const onApplySocketCan = async (enabled: boolean, iface: string): Promise<void> => {
    setSocketCanBusy(true);
    setSocketCanError(undefined);
    try {
      const res = await fetch('/api/socketcan', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ enabled, interface: iface }),
      });
      const j = (await res.json()) as
        | {
            ok: true;
            state: { enabled: boolean; interface: string; running: boolean };
          }
        | {
            ok: false;
            error?: { message?: string };
            state?: { enabled: boolean; interface: string; running: boolean };
          };
      if (j.ok) {
        setSocketCanEnabled(j.state.enabled);
        setSocketCanInterface(j.state.interface);
        setSocketCanRunning(j.state.running);
      } else {
        // Even on driver_failed, the persisted state is now `enabled:true`
        // and `running:false` — surface the error but reflect the
        // returned state if present.
        if (j.state) {
          setSocketCanEnabled(j.state.enabled);
          setSocketCanInterface(j.state.interface);
          setSocketCanRunning(j.state.running);
        }
        setSocketCanError(j.error?.message ?? 'SocketCAN toggle failed');
      }
    } catch (e) {
      setSocketCanError(String(e));
    } finally {
      setSocketCanBusy(false);
    }
  };

  const onSetSourceMode = async (mode: 'live' | 'demo'): Promise<void> => {
    if (sourceMode?.mode === mode) return;
    setSourceModeBusy(true);
    setSourceModeError(undefined);
    try {
      const res = await fetch('/api/source-mode', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ mode }),
      });
      const j = (await res.json()) as SourceModeStatus | { error: string };
      if ('error' in j) setSourceModeError(j.error);
      else setSourceMode(j);
    } catch (e) {
      setSourceModeError(String(e));
    } finally {
      setSourceModeBusy(false);
    }
  };

  return (
    <main className="p-8 max-w-2xl space-y-4 text-slate-200">
      <h1 className="text-2xl">Settings</h1>

      <fieldset
        className={`border rounded p-3 space-y-2 ${
          sourceMode?.mode === 'demo'
            ? 'border-amber-600 bg-amber-900/10'
            : sourceMode?.mode === 'replay'
              ? 'border-violet-600 bg-violet-900/10'
              : 'border-slate-700'
        }`}
      >
        <legend className="px-2 text-sm text-slate-300">Source mode</legend>
        <p className="text-[11px] text-slate-500">
          Switches the data source feeding the bus and pipelines. <strong>Live</strong> ingests from
          the real NMEA hardware (NGT-1 / YDWG / 0183). <strong>Demo</strong> swaps in a synthetic
          injector — useful on the dock or for UI work without a boat. <strong>Replay</strong> mode
          (not switchable here) is started via the Sessions page.
        </p>
        <div className="flex items-center gap-4 flex-wrap text-sm">
          <label className="flex items-center gap-2">
            <input
              type="radio"
              name="source-mode"
              value="live"
              checked={sourceMode?.mode === 'live'}
              disabled={sourceModeBusy || sourceMode === null}
              onChange={() => void onSetSourceMode('live')}
            />
            <span>Live</span>
          </label>
          <label className="flex items-center gap-2">
            <input
              type="radio"
              name="source-mode"
              value="demo"
              checked={sourceMode?.mode === 'demo'}
              disabled={sourceModeBusy || sourceMode === null}
              onChange={() => void onSetSourceMode('demo')}
            />
            <span>Demo</span>
          </label>
          {sourceMode?.mode === 'replay' && (
            <span className="text-violet-300 font-mono text-xs">
              replay · {sourceMode.sessionId ?? 'unknown'} · {sourceMode.phase ?? '—'}
            </span>
          )}
          {sourceModeBusy && <span className="text-slate-500 text-xs">Switching…</span>}
        </div>
        {sourceMode?.mode === 'demo' && (
          <div className="text-amber-300 text-xs">
            ⚠ Demo data is synthetic — anything plotted on /chart or /helm is fake. Switch back to{' '}
            <strong>Live</strong> before relying on navigation data.
          </div>
        )}
        {sourceModeError && <div className="text-rose-400 text-xs">{sourceModeError}</div>}
      </fieldset>

      <fieldset
        className={`border rounded p-3 space-y-2 ${
          socketCanRunning
            ? 'border-sky-600 bg-sky-900/10'
            : socketCanEnabled
              ? 'border-amber-600 bg-amber-900/10'
              : 'border-slate-700'
        }`}
      >
        <legend className="px-2 text-sm text-slate-300">Live ingest — SocketCAN (PiCAN-M)</legend>
        <p className="text-[11px] text-slate-500">
          Reads N2K frames directly from a Linux SocketCAN interface (e.g. the PiCAN-M HAT on the
          boat Pi). Runs <em>alongside</em> YDWG-02 and NGT-1 — the bridge dedupes by source address
          + PGN, so toggling this on while YDWG stays connected is safe for verification.
        </p>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={socketCanEnabled}
            disabled={socketCanBusy}
            onChange={(e) =>
              void onApplySocketCan(e.target.checked, socketCanInterface.trim() || 'can0')
            }
          />
          <span>Enable SocketCAN ingest</span>
          {socketCanBusy && <span className="text-xs text-slate-500">Applying…</span>}
          {!socketCanBusy && socketCanEnabled && socketCanRunning && (
            <span className="text-xs text-sky-300 font-mono">running</span>
          )}
          {!socketCanBusy && socketCanEnabled && !socketCanRunning && (
            <span className="text-xs text-amber-300 font-mono">
              not running (driver failed to start)
            </span>
          )}
        </label>
        <label className="block text-sm">
          CAN interface name
          <input
            type="text"
            value={socketCanInterface}
            onChange={(e) => setSocketCanInterface(e.target.value)}
            onBlur={() => {
              // Apply only if the value actually changed AND the toggle is
              // on — otherwise we'd thrash the driver for no reason.
              if (
                socketCanEnabled &&
                socketCanInterface.trim().length > 0 &&
                socketCanInterface.trim() !== 'can0'
              ) {
                void onApplySocketCan(true, socketCanInterface.trim());
              }
            }}
            placeholder="can0"
            disabled={socketCanBusy}
            className="bg-slate-900 border border-slate-700 rounded px-2 py-1 w-48 font-mono disabled:opacity-40"
          />
          <span className="text-[10px] text-slate-500 ml-2">
            usually <code>can0</code>; <code>vcan0</code> for virtual-CAN testing
          </span>
        </label>
        <p className="text-[11px] text-slate-500">
          Takes effect immediately — the driver is added to or removed from the live bridge via{' '}
          <code>/api/socketcan</code> without a service restart. Persisted to{' '}
          <code>~/.g5000-router/settings.json</code> so it also survives the next reboot. Requires{' '}
          <code>socketcan</code> npm package on the Pi and the <code>mcp2515-can0</code> dt-overlay
          loaded with the interface up at 250 kbit/s.
        </p>
        {socketCanError && <div className="text-rose-400 text-xs">{socketCanError}</div>}
      </fieldset>

      <SatelliteCachePanel />

      <PlanningSection />
    </main>
  );
}
