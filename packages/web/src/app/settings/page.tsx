'use client';
import { useEffect, useState } from 'react';

type SourceMode = 'live' | 'demo' | 'replay';
interface SourceModeStatus {
  mode: SourceMode;
  sessionId?: string;
  paceMode?: 'realtime' | 'asap';
  phase?: 'running' | 'finished' | 'error';
  startedAt?: string;
  errorMessage?: string;
}

interface Bbox {
  latMin: number;
  latMax: number;
  lonMin: number;
  lonMax: number;
}

interface SocketCanConfig {
  enabled: boolean;
  interface: string;
}

interface Settings {
  g5000Host?: string;
  wgrib2Path?: string;
  cacheRoot?: string;
  /**
   * Region of interest for the periodic forecast refresh timer on the Pi.
   * Set generously enough to cover where the boat might be over a passage
   * — the script reads this on every fire, so changing it here takes effect
   * on the next 3 h tick.
   */
  forecastBbox?: Bbox;
  /**
   * Opt-in SocketCAN ingest for the PiCAN-M HAT. Default: disabled (current
   * fleet uses YDWG/NGT-1). When enabled, the autopilot-server boots an
   * additional SocketCanDriver alongside YDWG. Takes effect on next service
   * restart — the bridge wires drivers at boot.
   */
  socketCan?: SocketCanConfig;
}

const DEFAULT_FORECAST_BBOX: Bbox = {
  latMin: 25,
  latMax: 45,
  lonMin: -80,
  lonMax: -55,
};

// Env-derived defaults shown alongside persisted values so the user sees
// what the system falls back to when a setting is empty. Kept in sync with
// `lib/paths.ts` and `lib/g5000-client.ts`.
const DEFAULTS = {
  g5000Host: 'http://g5000.local:3000',
  wgrib2Path: 'wgrib2',
  cacheRoot: '~/.g5000-router/grib-cache',
};

export default function SettingsPage() {
  const [g5000Host, setG5000Host] = useState<string>('');
  const [wgrib2Path, setWgrib2Path] = useState<string>('');
  const [cacheRoot, setCacheRoot] = useState<string>('');
  const [bboxLatMin, setBboxLatMin] = useState<string>('');
  const [bboxLatMax, setBboxLatMax] = useState<string>('');
  const [bboxLonMin, setBboxLonMin] = useState<string>('');
  const [bboxLonMax, setBboxLonMax] = useState<string>('');
  const [loading, setLoading] = useState<boolean>(true);
  const [saving, setSaving] = useState<boolean>(false);
  const [status, setStatus] = useState<string | undefined>();
  const [error, setError] = useState<string | undefined>();

  // Source-mode state — separate from the persisted settings above because
  // it's a runtime-only switch (lives in the SourceModeController, not
  // settings.json). Polled so the UI reflects any out-of-band switch.
  const [sourceMode, setSourceMode] = useState<SourceModeStatus | null>(null);
  const [sourceModeBusy, setSourceModeBusy] = useState<boolean>(false);
  const [sourceModeError, setSourceModeError] = useState<string | undefined>();

  // SocketCAN (PiCAN-M) config. Persisted via /api/settings; takes effect
  // on next autopilot-server restart.
  const [socketCanEnabled, setSocketCanEnabled] = useState<boolean>(false);
  const [socketCanInterface, setSocketCanInterface] = useState<string>('can0');

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch('/api/settings');
        const j = await res.json();
        if (cancelled) return;
        if (!j.ok) {
          setError(j.error?.message ?? 'failed to load settings');
          return;
        }
        const s: Settings = j.settings ?? {};
        setG5000Host(typeof s.g5000Host === 'string' ? s.g5000Host : '');
        setWgrib2Path(typeof s.wgrib2Path === 'string' ? s.wgrib2Path : '');
        setCacheRoot(typeof s.cacheRoot === 'string' ? s.cacheRoot : '');
        if (s.forecastBbox) {
          setBboxLatMin(String(s.forecastBbox.latMin));
          setBboxLatMax(String(s.forecastBbox.latMax));
          setBboxLonMin(String(s.forecastBbox.lonMin));
          setBboxLonMax(String(s.forecastBbox.lonMax));
        }
        if (s.socketCan) {
          setSocketCanEnabled(s.socketCan.enabled === true);
          if (typeof s.socketCan.interface === 'string' && s.socketCan.interface.length > 0) {
            setSocketCanInterface(s.socketCan.interface);
          }
        }
      } catch (e) {
        if (!cancelled) setError(String(e));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

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

  const onSave = async () => {
    setError(undefined);
    setStatus(undefined);
    setSaving(true);
    try {
      const body: Settings = {};
      if (g5000Host.trim()) body.g5000Host = g5000Host.trim();
      if (wgrib2Path.trim()) body.wgrib2Path = wgrib2Path.trim();
      if (cacheRoot.trim()) body.cacheRoot = cacheRoot.trim();
      const parseBbox = (): Bbox | null => {
        const fields = [bboxLatMin, bboxLatMax, bboxLonMin, bboxLonMax];
        if (fields.every((f) => f.trim() === '')) return null;
        const nums = fields.map(Number);
        if (nums.some((n) => !Number.isFinite(n))) {
          throw new Error('Bbox fields must all be numbers (or all blank for default)');
        }
        const [latMin, latMax, lonMin, lonMax] = nums as [number, number, number, number];
        if (latMin >= latMax || lonMin >= lonMax) {
          throw new Error('Bbox is degenerate (latMin/lonMin must be less than latMax/lonMax)');
        }
        return { latMin, latMax, lonMin, lonMax };
      };
      const bbox = parseBbox();
      if (bbox) body.forecastBbox = bbox;
      // Always include socketCan: this is a discrete on/off toggle and
      // we want the persisted file to reflect the current UI state
      // unambiguously (vs "leave blank to inherit default").
      body.socketCan = {
        enabled: socketCanEnabled,
        interface: socketCanInterface.trim() || 'can0',
      };
      const res = await fetch('/api/settings', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
      const j = await res.json();
      if (!j.ok) {
        setError(j.error?.message ?? 'save failed');
        return;
      }
      setStatus('Saved.');
    } catch (e) {
      setError(String(e));
    } finally {
      setSaving(false);
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
          Switches the data source feeding the bus and pipelines.{' '}
          <strong>Live</strong> ingests from the real NMEA hardware
          (NGT-1 / YDWG / 0183). <strong>Demo</strong> swaps in a synthetic
          injector — useful on the dock or for UI work without a boat.{' '}
          <strong>Replay</strong> mode (not switchable here) is started via the
          Sessions page.
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
          {sourceModeBusy && (
            <span className="text-slate-500 text-xs">Switching…</span>
          )}
        </div>
        {sourceMode?.mode === 'demo' && (
          <div className="text-amber-300 text-xs">
            ⚠ Demo data is synthetic — anything plotted on /chart or /helm is
            fake. Switch back to <strong>Live</strong> before relying on
            navigation data.
          </div>
        )}
        {sourceModeError && (
          <div className="text-rose-400 text-xs">{sourceModeError}</div>
        )}
      </fieldset>

      <fieldset
        className={`border rounded p-3 space-y-2 ${
          socketCanEnabled ? 'border-sky-700 bg-sky-900/10' : 'border-slate-700'
        }`}
      >
        <legend className="px-2 text-sm text-slate-300">
          Live ingest — SocketCAN (PiCAN-M)
        </legend>
        <p className="text-[11px] text-slate-500">
          Reads N2K frames directly from a Linux SocketCAN interface (i.e. the
          PiCAN-M HAT on the boat Pi). Runs <em>alongside</em> the YDWG-02 and
          NGT-1 drivers — the bridge dedupes by source address + PGN, so
          turning this on while YDWG stays connected is safe for verification.
          Default off; the boat is on YDWG.
        </p>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={socketCanEnabled}
            onChange={(e) => setSocketCanEnabled(e.target.checked)}
          />
          <span>Enable SocketCAN ingest</span>
        </label>
        <label className="block text-sm">
          CAN interface name
          <input
            type="text"
            value={socketCanInterface}
            onChange={(e) => setSocketCanInterface(e.target.value)}
            placeholder="can0"
            disabled={!socketCanEnabled}
            className="bg-slate-900 border border-slate-700 rounded px-2 py-1 w-48 font-mono disabled:opacity-40"
          />
          <span className="text-[10px] text-slate-500 ml-2">
            usually <code>can0</code>; <code>vcan0</code> for virtual-CAN testing
          </span>
        </label>
        <p className="text-[11px] text-amber-400">
          Takes effect on next <code>systemctl restart g5000-autopilot</code>.
          Requires the <code>socketcan</code> npm package on the Pi and the
          <code>mcp2515-can0</code> dt-overlay loaded with the interface up at
          250 kbit/s.
        </p>
      </fieldset>

      <p className="text-xs text-slate-400">
        The fields below are persisted to <code>~/.g5000-router/settings.json</code>.
        Leave a field blank to fall back to the env-derived default shown below it.
      </p>
      {loading ? (
        <div className="text-slate-400 text-sm">Loading…</div>
      ) : (
        <div className="space-y-4">
          <label className="block text-sm">
            G5000 host URL
            <input
              type="text"
              value={g5000Host}
              onChange={(e) => setG5000Host(e.target.value)}
              placeholder={DEFAULTS.g5000Host}
              className="bg-slate-900 border border-slate-700 rounded px-2 py-1 w-full font-mono"
            />
            <span className="text-[10px] text-slate-500">
              default: <code>{DEFAULTS.g5000Host}</code> (env <code>G5000_HOST</code>)
            </span>
          </label>
          <label className="block text-sm">
            wgrib2 path
            <input
              type="text"
              value={wgrib2Path}
              onChange={(e) => setWgrib2Path(e.target.value)}
              placeholder={DEFAULTS.wgrib2Path}
              className="bg-slate-900 border border-slate-700 rounded px-2 py-1 w-full font-mono"
            />
            <span className="text-[10px] text-slate-500">
              default: <code>{DEFAULTS.wgrib2Path}</code> (resolved on PATH)
            </span>
          </label>
          <label className="block text-sm">
            Cache root
            <input
              type="text"
              value={cacheRoot}
              onChange={(e) => setCacheRoot(e.target.value)}
              placeholder={DEFAULTS.cacheRoot}
              className="bg-slate-900 border border-slate-700 rounded px-2 py-1 w-full font-mono"
            />
            <span className="text-[10px] text-slate-500">
              default: <code>{DEFAULTS.cacheRoot}</code> (env <code>G5000_ROUTER_ROOT</code>)
            </span>
          </label>
          <fieldset className="border border-slate-700 rounded p-3 space-y-2">
            <legend className="px-2 text-sm text-slate-300">
              Forecast refresh ROI
            </legend>
            <p className="text-[10px] text-slate-500 mb-2">
              Bounding box for the periodic forecast refresh on the Pi (every 3 h
              via g5000-forecast-refresh.timer). Leave blank to use default
              ({DEFAULT_FORECAST_BBOX.latMin}–{DEFAULT_FORECAST_BBOX.latMax}°N,{' '}
              {Math.abs(DEFAULT_FORECAST_BBOX.lonMax)}–
              {Math.abs(DEFAULT_FORECAST_BBOX.lonMin)}°W).
            </p>
            <div className="grid grid-cols-4 gap-2">
              <label className="block text-xs">
                latMin
                <input
                  type="number"
                  step="0.1"
                  value={bboxLatMin}
                  onChange={(e) => setBboxLatMin(e.target.value)}
                  placeholder={String(DEFAULT_FORECAST_BBOX.latMin)}
                  className="bg-slate-900 border border-slate-700 rounded px-2 py-1 w-full font-mono"
                />
              </label>
              <label className="block text-xs">
                latMax
                <input
                  type="number"
                  step="0.1"
                  value={bboxLatMax}
                  onChange={(e) => setBboxLatMax(e.target.value)}
                  placeholder={String(DEFAULT_FORECAST_BBOX.latMax)}
                  className="bg-slate-900 border border-slate-700 rounded px-2 py-1 w-full font-mono"
                />
              </label>
              <label className="block text-xs">
                lonMin
                <input
                  type="number"
                  step="0.1"
                  value={bboxLonMin}
                  onChange={(e) => setBboxLonMin(e.target.value)}
                  placeholder={String(DEFAULT_FORECAST_BBOX.lonMin)}
                  className="bg-slate-900 border border-slate-700 rounded px-2 py-1 w-full font-mono"
                />
              </label>
              <label className="block text-xs">
                lonMax
                <input
                  type="number"
                  step="0.1"
                  value={bboxLonMax}
                  onChange={(e) => setBboxLonMax(e.target.value)}
                  placeholder={String(DEFAULT_FORECAST_BBOX.lonMax)}
                  className="bg-slate-900 border border-slate-700 rounded px-2 py-1 w-full font-mono"
                />
              </label>
            </div>
          </fieldset>
          <button
            disabled={saving}
            onClick={onSave}
            className="bg-emerald-700 disabled:bg-slate-700 px-4 py-2 rounded text-sm"
          >
            {saving ? 'Saving…' : 'Save'}
          </button>
          {status && <div className="text-emerald-400 text-xs">{status}</div>}
          {error && <div className="text-rose-400 text-xs">{error}</div>}
        </div>
      )}
    </main>
  );
}
