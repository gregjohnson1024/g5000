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
        <p className="text-[11px] text-slate-500">
          0 kn threshold = never motor. Set high to always motor.
        </p>
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

function TideCurrentsSection() {
  const [enabled, setEnabled] = useState(false);
  const [status, setStatus] = useState<string | null>(null);

  useEffect(() => {
    void fetch('/api/settings')
      .then((r) => r.json())
      .then((j) => {
        if (j.ok) setEnabled(j.settings?.canadianTideCurrents === true);
      })
      .catch(() => {});
  }, []);

  // Read-merge-write: PUT /api/settings replaces the whole file, so merge
  // onto the current settings rather than clobbering keys other sections own.
  const apply = async (next: boolean) => {
    setEnabled(next);
    setStatus('Saving…');
    const cur = await fetch('/api/settings')
      .then((r) => r.json())
      .catch(() => ({ settings: {} }));
    const merged = { ...(cur.settings ?? {}), canadianTideCurrents: next };
    const res = await fetch('/api/settings', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(merged),
    });
    setStatus(res.ok ? 'Saved' : 'Save failed');
    setTimeout(() => setStatus(null), 2500);
  };

  return (
    <section className="space-y-3 border border-slate-800 rounded p-3">
      <h2 className="text-lg font-semibold">Tide &amp; currents</h2>
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" checked={enabled} onChange={(e) => void apply(e.target.checked)} />
        Canadian Tide/Currents (CHS stations)
      </label>
      <p className="text-[11px] text-slate-500">
        Shows the Tide and Currents tabs plus the chart&apos;s station overlays. Station data covers
        Canadian waters only, so this is off by default.
      </p>
      {status && <span className="text-sm text-slate-400">{status}</span>}
    </section>
  );
}

// ---------------------------------------------------------------------------
// Anchor dashboard settings
// ---------------------------------------------------------------------------

interface AnchorDashboardConfig {
  bowHeightM?: number;
  droopDeductM?: number;
  depthOffsets?: {
    keelBelowTransducerM?: number;
    transducerToWaterlineM?: number;
  };
  weatherPin?: { lat: number; lon: number } | null;
}

function AnchorDashboardSection() {
  const [cfg, setCfg] = useState<AnchorDashboardConfig>({});
  const [pinEnabled, setPinEnabled] = useState(false);
  const [pinLat, setPinLat] = useState('');
  const [pinLon, setPinLon] = useState('');
  const [status, setStatus] = useState<string | null>(null);

  useEffect(() => {
    void fetch('/api/settings')
      .then((r) => r.json())
      .then((j) => {
        if (j.ok && j.settings?.anchorDashboard) {
          const a = j.settings.anchorDashboard as AnchorDashboardConfig;
          setCfg(a);
          if (a.weatherPin) {
            setPinEnabled(true);
            setPinLat(String(a.weatherPin.lat));
            setPinLon(String(a.weatherPin.lon));
          }
        }
      })
      .catch(() => {});
  }, []);

  const save = async () => {
    setStatus('Saving…');
    const la = parseFloat(pinLat);
    const lo = parseFloat(pinLon);
    const weatherPin: AnchorDashboardConfig['weatherPin'] =
      pinEnabled && Number.isFinite(la) && Number.isFinite(lo) ? { lat: la, lon: lo } : null;
    const next: AnchorDashboardConfig = { ...cfg, weatherPin };
    const cur = await fetch('/api/settings')
      .then((r) => r.json())
      .catch(() => ({ settings: {} }));
    const merged = { ...(cur.settings ?? {}), anchorDashboard: next };
    const res = await fetch('/api/settings', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(merged),
    });
    setStatus(res.ok ? 'Saved' : 'Save failed');
    setTimeout(() => setStatus(null), 2500);
  };

  const numInput = (
    label: string,
    hint: string,
    value: number | undefined,
    onChange: (v: number | undefined) => void,
  ) => (
    <label className="block text-sm">
      {label}
      <input
        type="number"
        min={0}
        step={0.1}
        value={value ?? ''}
        onChange={(e) => {
          const v = parseFloat(e.target.value);
          onChange(e.target.value === '' || Number.isNaN(v) ? undefined : v);
        }}
        placeholder="—"
        className="bg-slate-900 border border-slate-700 rounded px-2 py-1 w-28 ml-2"
      />
      <span className="block text-[11px] text-slate-500">{hint}</span>
    </label>
  );

  return (
    <section className="space-y-3 border border-slate-800 rounded p-3">
      <h2 className="text-lg font-semibold">Anchor dashboard</h2>

      <fieldset className="border border-slate-800 rounded p-2 space-y-2">
        <legend className="text-sm px-1">Rode &amp; scope</legend>
        {numInput(
          'Bow height (m)',
          'Height of bow chock above the waterline.',
          cfg.bowHeightM,
          (v) => setCfg((s) => ({ ...s, bowHeightM: v })),
        )}
        {numInput(
          'Droop deduct (m)',
          'Catenary sag to subtract from the counter reading.',
          cfg.droopDeductM,
          (v) => setCfg((s) => ({ ...s, droopDeductM: v })),
        )}
      </fieldset>

      <fieldset className="border border-slate-800 rounded p-2 space-y-2">
        <legend className="text-sm px-1">Depth offsets</legend>
        {numInput(
          'Keel below transducer (m)',
          'Depth under keel = sounder − this value.',
          cfg.depthOffsets?.keelBelowTransducerM,
          (v) =>
            setCfg((s) => ({
              ...s,
              depthOffsets: { ...s.depthOffsets, keelBelowTransducerM: v },
            })),
        )}
        {numInput(
          'Transducer to waterline (m)',
          'Total water depth = sounder + this value.',
          cfg.depthOffsets?.transducerToWaterlineM,
          (v) =>
            setCfg((s) => ({
              ...s,
              depthOffsets: { ...s.depthOffsets, transducerToWaterlineM: v },
            })),
        )}
      </fieldset>

      <fieldset className="border border-slate-800 rounded p-2 space-y-2">
        <legend className="text-sm px-1">Weather pin</legend>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={pinEnabled}
            onChange={(e) => setPinEnabled(e.target.checked)}
          />
          Pin weather to a fixed position (instead of following the live GPS fix)
        </label>
        {pinEnabled && (
          <div className="flex flex-wrap gap-3 text-sm">
            <label className="block">
              Lat
              <input
                type="number"
                step="0.0001"
                value={pinLat}
                onChange={(e) => setPinLat(e.target.value)}
                placeholder="e.g. 41.63"
                className="bg-slate-900 border border-slate-700 rounded px-2 py-1 w-32 ml-2"
              />
            </label>
            <label className="block">
              Lon
              <input
                type="number"
                step="0.0001"
                value={pinLon}
                onChange={(e) => setPinLon(e.target.value)}
                placeholder="e.g. -71.26"
                className="bg-slate-900 border border-slate-700 rounded px-2 py-1 w-32 ml-2"
              />
            </label>
          </div>
        )}
        <p className="text-[11px] text-slate-500">
          When unchecked, the anchor page weather and forecast follow the live GPS position.
        </p>
      </fieldset>

      <div className="flex items-center gap-3">
        <button onClick={() => void save()} className="bg-emerald-700 px-3 py-1 rounded text-sm">
          Save anchor settings
        </button>
        {status && <span className="text-sm text-slate-400">{status}</span>}
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Emporia AC settings
// ---------------------------------------------------------------------------

type Leg = 'L1' | 'L2' | '240V';

interface EmporiaConfig {
  legAssignments: Record<string, Leg>;
  hiddenChannels: string[];
}

interface EmporiaChannelInfo {
  channelNum: string;
  name: string;
  multiplier: number;
}

const SKIP_CHANNEL_NUMS_SETTINGS = new Set(['1,2,3']);
const SKIP_NAMES_SETTINGS = /^balance$/i;

function EmporiaAcSection() {
  const [channels, setChannels] = useState<EmporiaChannelInfo[]>([]);
  const [devicesLoaded, setDevicesLoaded] = useState(false);
  const [cfg, setCfg] = useState<EmporiaConfig>({ legAssignments: {}, hiddenChannels: [] });
  const [status, setStatus] = useState<string | null>(null);

  useEffect(() => {
    // Load existing config from settings
    void fetch('/api/settings')
      .then((r) => r.json())
      .then((j) => {
        if (j.ok && j.settings?.emporiaConfig) {
          setCfg(j.settings.emporiaConfig as EmporiaConfig);
        }
      })
      .catch(() => {});

    // Load channels from devices
    void fetch('/api/emporia/devices', { cache: 'no-store' })
      .then((r) => r.json())
      .then((j: { devices: Array<{ channels: EmporiaChannelInfo[] }> }) => {
        const all: EmporiaChannelInfo[] = [];
        for (const dev of j.devices ?? []) {
          for (const ch of dev.channels) {
            if (SKIP_CHANNEL_NUMS_SETTINGS.has(ch.channelNum)) continue;
            if (SKIP_NAMES_SETTINGS.test(ch.name)) continue;
            all.push(ch);
          }
        }
        setChannels(all);
        setDevicesLoaded(true);
      })
      .catch(() => {
        setDevicesLoaded(true);
      });
  }, []);

  const setLeg = (channelNum: string, leg: Leg | '') => {
    setCfg((prev) => {
      const next = { ...prev.legAssignments };
      if (leg === '') {
        delete next[channelNum];
      } else {
        next[channelNum] = leg;
      }
      return { ...prev, legAssignments: next };
    });
  };

  const setHidden = (channelNum: string, hidden: boolean) => {
    setCfg((prev) => {
      const set = new Set(prev.hiddenChannels);
      if (hidden) set.add(channelNum);
      else set.delete(channelNum);
      return { ...prev, hiddenChannels: [...set] };
    });
  };

  const save = async () => {
    setStatus('Saving…');
    // Abort instead of clobbering: if we can't read the current settings we
    // must NOT PUT, because PUT replaces the whole file and would wipe every
    // other section's keys.
    let curSettings: Record<string, unknown> | null = null;
    try {
      const r = await fetch('/api/settings');
      if (r.ok) {
        const j = (await r.json()) as { ok?: boolean; settings?: Record<string, unknown> };
        if (j.ok && j.settings) curSettings = j.settings;
      }
    } catch {
      // network error — handled below
    }
    if (!curSettings) {
      setStatus("Save failed — couldn't read current settings");
      setTimeout(() => setStatus(null), 4000);
      return;
    }
    const merged = { ...curSettings, emporiaConfig: cfg };
    const res = await fetch('/api/settings', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(merged),
    });
    setStatus(res.ok ? 'Saved' : 'Save failed');
    setTimeout(() => setStatus(null), 2500);
  };

  const legs: Array<{ value: Leg | ''; label: string }> = [
    { value: '', label: '—' },
    { value: 'L1', label: 'L1' },
    { value: 'L2', label: 'L2' },
    { value: '240V', label: '240V' },
  ];

  return (
    <section className="space-y-3 border border-slate-800 rounded p-3">
      <h2 className="text-lg font-semibold">Emporia AC</h2>
      <p className="text-[11px] text-slate-500">
        Assign each circuit to a leg (L1 / L2 / 240V) or hide it from the AC Loads view. Requires an
        Emporia Vue 3 connected or <code>EMPORIA_SIM=1</code>.
      </p>

      {!devicesLoaded && <p className="text-slate-500 text-xs italic">Loading channels…</p>}

      {devicesLoaded && channels.length === 0 && (
        <p className="text-slate-500 text-xs italic">
          No Emporia device found (connect one, or run with EMPORIA_SIM=1).
        </p>
      )}

      {devicesLoaded && channels.length > 0 && (
        <div className="flex flex-col gap-2">
          <div className="grid grid-cols-[1fr_auto_auto] gap-x-3 gap-y-1 items-center text-[11px] text-slate-500 uppercase tracking-wide">
            <span>Circuit</span>
            <span>Leg</span>
            <span>Hide</span>
          </div>
          {channels.map((ch) => (
            <div
              key={ch.channelNum}
              className="grid grid-cols-[1fr_auto_auto] gap-x-3 items-center text-sm"
            >
              <span className="text-slate-300 truncate">
                {ch.name}
                <span className="text-slate-600 ml-1 text-[10px]">#{ch.channelNum}</span>
              </span>
              <select
                value={cfg.legAssignments[ch.channelNum] ?? ''}
                onChange={(e) => setLeg(ch.channelNum, e.target.value as Leg | '')}
                className="bg-slate-900 border border-slate-700 rounded px-1 py-0.5 text-sm"
              >
                {legs.map((l) => (
                  <option key={l.value} value={l.value}>
                    {l.label}
                  </option>
                ))}
              </select>
              <input
                type="checkbox"
                checked={cfg.hiddenChannels.includes(ch.channelNum)}
                onChange={(e) => setHidden(ch.channelNum, e.target.checked)}
                className="accent-sky-500"
              />
            </div>
          ))}
        </div>
      )}

      <div className="flex items-center gap-3">
        <button
          onClick={() => void save()}
          className="bg-emerald-700 px-3 py-1 rounded text-sm"
          disabled={!devicesLoaded || channels.length === 0}
        >
          Save Emporia settings
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

      <TideCurrentsSection />

      <AnchorDashboardSection />

      <EmporiaAcSection />
    </main>
  );
}
