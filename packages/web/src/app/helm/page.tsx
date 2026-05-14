'use client';

import { useCallback, useEffect, useRef, useState, type ReactElement } from 'react';
import type { JsonSafeSample } from '@g5000/core';
import type { SailWardrobe } from '@g5000/db';
import { useSse } from '../../hooks/use-sse';
import { HelmTile } from './HelmTile';

const MS_TO_KNOTS = 1 / 0.514444;
const RAD_TO_DEG = 180 / Math.PI;
const AVG_WINDOW_MS = 15 * 60 * 1000;

function scalar(s: JsonSafeSample | undefined): number | null {
  if (!s || s.value.kind !== 'scalar') return null;
  return s.value.value;
}

function geo(s: JsonSafeSample | undefined): { lat: number; lon: number } | null {
  if (!s || s.value.kind !== 'geo') return null;
  return s.value.value;
}

// Marine DMM format matching the rest of the app:
// `33 42.232n` — integer degrees, decimal minutes, lowercase hemisphere
// glued to the minute number with no separator.
function fmtLat(lat: number): string {
  const abs = Math.abs(lat);
  const deg = Math.floor(abs);
  const min = ((abs - deg) * 60).toFixed(3);
  return `${deg} ${min}${lat >= 0 ? 'n' : 's'}`;
}

function fmtLon(lon: number): string {
  const abs = Math.abs(lon);
  const deg = Math.floor(abs);
  const min = ((abs - deg) * 60).toFixed(3);
  return `${deg} ${min}${lon >= 0 ? 'e' : 'w'}`;
}

function fmtSpeed(s: JsonSafeSample | undefined): string {
  const v = scalar(s);
  return v === null ? '—' : `${(v * MS_TO_KNOTS).toFixed(1)}`;
}

function fmtAngleSigned(s: JsonSafeSample | undefined): string {
  const v = scalar(s);
  if (v === null) return '—';
  const deg = v * RAD_TO_DEG;
  const sign = deg >= 0 ? '+' : '';
  return `${sign}${deg.toFixed(0)}`;
}

function fmtHeading(s: JsonSafeSample | undefined): string {
  const v = scalar(s);
  return fmtHeadingRad(v);
}

function fmtHeadingRad(v: number | null): string {
  if (v === null) return '—';
  let deg = v * RAD_TO_DEG;
  while (deg < 0) deg += 360;
  while (deg >= 360) deg -= 360;
  return `${deg.toFixed(0)}`;
}

export default function HelmPage() {
  const { channels, connected } = useSse();
  const [wardrobe, setWardrobe] = useState<SailWardrobe | null>(null);

  const reloadWardrobe = useCallback(async () => {
    try {
      const r = await fetch('/api/sails', { cache: 'no-store' });
      if (!r.ok) return;
      setWardrobe((await r.json()) as SailWardrobe);
    } catch {
      /* ignore */
    }
  }, []);

  useEffect(() => {
    void reloadWardrobe();
  }, [reloadWardrobe]);

  const swapActive = async (configId: string) => {
    await fetch('/api/sails/active', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ configId }),
    });
    await reloadWardrobe();
  };

  // Wind + polar/VMG channels intentionally not subscribed — no wind sensor attached.
  const sog = channels.get('nav.gps.sog');
  // COG can arrive in either True or Magnetic reference; prefer True.
  const cogTrue = channels.get('nav.gps.cog');
  const cogMag = channels.get('nav.gps.cog.magnetic');
  const cog = cogTrue ?? cogMag;
  const cogRef = cogTrue ? 'T' : cogMag ? 'M' : null;

  // HDG: prefer a direct True publisher. If only Magnetic is available, add
  // live magnetic variation (PGN 127258) to compute True. Fall back to raw
  // Magnetic only if variation is also missing.
  const hdgTrueSample = channels.get('boat.heading.true');
  const hdgMagSample = channels.get('boat.heading.magnetic');
  const magVarSample = channels.get('nav.magvar');
  const hdgTrueRad = scalar(hdgTrueSample);
  const hdgMagRad = scalar(hdgMagSample);
  const magVarRad = scalar(magVarSample);
  let hdgValueRad: number | null = null;
  let hdgRef: 'T' | 'M' | null = null;
  if (hdgTrueRad !== null) {
    hdgValueRad = hdgTrueRad;
    hdgRef = 'T';
  } else if (hdgMagRad !== null && magVarRad !== null) {
    hdgValueRad = hdgMagRad + magVarRad; // True = Magnetic + Variation (East-positive).
    hdgRef = 'T';
  } else if (hdgMagRad !== null) {
    hdgValueRad = hdgMagRad;
    hdgRef = 'M';
  }

  const heel = channels.get('motion.heel');
  const pitch = channels.get('motion.pitch');
  const position = geo(channels.get('nav.gps.position'));
  const positionLat = position ? fmtLat(position.lat) : null;
  const positionLon = position ? fmtLon(position.lon) : null;

  // Rolling 30-min average SOG. Buffer holds raw m/s samples keyed by
  // server-stamped t_ms; we prune-then-append on every new SOG event. Resets
  // when the page reloads (no server persistence) — sub-label shows the
  // actual window covered so a fresh page doesn't claim a 30-min average it
  // hasn't earned yet.
  const sogBufferRef = useRef<Array<{ t: number; v: number }>>([]);
  const [avgSog, setAvgSog] = useState<{ ms: number; coveredMs: number } | null>(null);
  const sogTms = sog?.t_ms;
  const sogScalar = scalar(sog);
  useEffect(() => {
    if (sogTms === undefined || sogScalar === null) return;
    const buf = sogBufferRef.current;
    buf.push({ t: sogTms, v: sogScalar });
    const cutoff = sogTms - AVG_WINDOW_MS;
    let drop = 0;
    while (drop < buf.length) {
      const head = buf[drop];
      if (head === undefined || head.t >= cutoff) break;
      drop++;
    }
    if (drop > 0) buf.splice(0, drop);
    const head = buf[0];
    if (!head) return;
    let sum = 0;
    for (const s of buf) sum += s.v;
    setAvgSog({ ms: sum / buf.length, coveredMs: sogTms - head.t });
  }, [sogTms, sogScalar]);

  return (
    <main className="p-4 min-h-screen bg-black">
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-xl font-semibold text-slate-300">Helm</h1>
        <div className="text-xs text-slate-500">{connected ? 'Live' : 'Reconnecting…'}</div>
      </div>
      <AlertsPanel />

      {wardrobe && (
        <div className="flex items-center gap-2 mb-3 text-sm bg-slate-900 border border-slate-800 rounded px-3 py-2">
          <span className="text-slate-400">Sails:</span>
          <select
            value={wardrobe.activeConfigId}
            onChange={(e) => swapActive(e.target.value)}
            className="bg-slate-900 border border-slate-700 rounded text-slate-200 px-2 py-1 text-sm"
          >
            {wardrobe.configs.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
          {wardrobe.configs.find((c) => c.id === wardrobe.activeConfigId)?.daggerboard && (
            <span className="px-2 py-0.5 rounded bg-amber-700 text-amber-100 text-xs font-mono uppercase">
              boards{' '}
              {wardrobe.configs.find((c) => c.id === wardrobe.activeConfigId)?.daggerboard}
            </span>
          )}
          <a href="/sails" className="text-xs text-slate-500 hover:text-slate-300 underline">
            manage
          </a>
        </div>
      )}

      {/* Wind-derived tiles (TWS/TWA/AWA, Target speed, % polar, VMG, Target VMG)
          hidden — no wind sensor attached. Re-add when masthead is wired. */}
      <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
        <HelmTile label="SOG" value={fmtSpeed(sog)} unit="kn" />
        <HelmTile
          label="COG"
          value={fmtHeading(cog)}
          unit="°"
          sub={cogRef ?? undefined}
        />
        <HelmTile
          label="HDG"
          value={fmtHeadingRad(hdgValueRad)}
          unit="°"
          sub={hdgRef ?? undefined}
        />

        <HelmTile
          label="Avg SOG"
          value={avgSog ? (avgSog.ms * MS_TO_KNOTS).toFixed(1) : '—'}
          unit="kn"
          sub={
            avgSog
              ? avgSog.coveredMs >= AVG_WINDOW_MS - 1000
                ? '15 min'
                : `${Math.max(1, Math.round(avgSog.coveredMs / 60000))} min so far`
              : '15 min'
          }
          small
        />

        <HelmTile label="Heel" value={fmtAngleSigned(heel)} unit="°" small />
        <HelmTile label="Pitch" value={fmtAngleSigned(pitch)} unit="°" small />

        {/* Position — two stacked coordinates rather than the one-number-per-tile
            idiom every other tile follows. Hemisphere suffixes ride at unit
            size so the magnitudes line up vertically. */}
        <div className="bg-slate-900 border border-slate-800 rounded p-4 flex flex-col gap-1 col-span-2">
          <div className="text-xs uppercase tracking-wider text-slate-400">Position</div>
          <div className="text-3xl font-mono text-slate-100 leading-tight">
            {positionLat ?? <span className="text-slate-500">—</span>}
          </div>
          <div className="text-3xl font-mono text-slate-100 leading-tight">
            {positionLon ?? <span className="text-slate-500">—</span>}
          </div>
        </div>
      </div>
    </main>
  );
}

interface AlertSnapshot {
  key: string;
  src: number;
  type: string;
  category?: string;
  state: string;
  ackStatus?: string;
  acknowledgeSupport?: boolean;
  priority?: number;
  text?: string;
  location?: string;
  lastSeenMs: number;
}

const ALERT_TYPE_STYLE: Record<string, string> = {
  'Emergency Alarm': 'bg-red-900/40 border-red-700 text-red-200',
  Alarm: 'bg-red-900/30 border-red-800 text-red-200',
  Warning: 'bg-amber-900/30 border-amber-700 text-amber-200',
  Caution: 'bg-yellow-900/30 border-yellow-700 text-yellow-200',
  unknown: 'bg-slate-800 border-slate-700 text-slate-200',
};

function AlertsPanel(): ReactElement | null {
  const [alerts, setAlerts] = useState<AlertSnapshot[]>([]);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const tick = async (): Promise<void> => {
      try {
        const r = await fetch('/api/alerts', { cache: 'no-store' });
        if (!r.ok || cancelled) return;
        const j = (await r.json()) as { alerts: AlertSnapshot[] };
        if (!cancelled) setAlerts(j.alerts);
      } catch {
        /* next tick retries */
      }
    };
    void tick();
    const id = setInterval(tick, 2000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, []);

  // Surface only alerts that aren't already in a resolved state AND
  // are still actively transmitting. Navico proprietary alerts have no
  // ack/cleared PGN we can rely on — the issuer just stops sending the
  // 130850 frames when the helmsman silences the alarm at the MFD. So
  // if we haven't seen a refresh in the last 5 seconds, consider it
  // cleared by the operator and hide the panel.
  const now = Date.now();
  const visible = alerts.filter(
    (a) =>
      a.state !== 'Normal' &&
      a.state !== 'Disabled' &&
      now - a.lastSeenMs < 5000,
  );
  if (visible.length === 0) return null;

  const acknowledge = async (key: string): Promise<void> => {
    setError(null);
    setBusyKey(key);
    try {
      const r = await fetch('/api/alerts/acknowledge', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key, command: 'Acknowledge' }),
      });
      const j = (await r.json()) as { ok: boolean; error?: { message?: string } };
      if (!j.ok) setError(j.error?.message ?? 'acknowledge failed');
    } catch (e) {
      setError(String(e));
    } finally {
      setBusyKey(null);
    }
  };

  return (
    <div className="mb-4 space-y-2">
      {visible.map((a) => {
        const style = ALERT_TYPE_STYLE[a.type] ?? ALERT_TYPE_STYLE.unknown;
        const sub = [
          a.state,
          a.priority !== undefined ? `prio ${a.priority}` : null,
          `src 0x${a.src.toString(16).padStart(2, '0')}`,
          a.category,
        ]
          .filter(Boolean)
          .join(' · ');
        return (
          <div
            key={a.key}
            className={`border rounded p-3 flex items-center gap-3 ${style}`}
          >
            <div className="flex-1">
              <div className="text-xs uppercase tracking-wide opacity-80">
                {a.type}
                {a.text ? <span className="ml-2 normal-case opacity-100">{a.text}</span> : null}
              </div>
              <div className="text-[10px] opacity-70 mt-0.5 font-mono">{sub}</div>
              {a.location && (
                <div className="text-[10px] opacity-70 italic">{a.location}</div>
              )}
            </div>
            <button
              type="button"
              disabled={busyKey === a.key || a.acknowledgeSupport === false}
              onClick={() => void acknowledge(a.key)}
              className="px-3 py-1.5 text-xs font-medium bg-slate-100 text-slate-900 rounded hover:bg-white disabled:opacity-40"
              title={
                a.acknowledgeSupport === false
                  ? "Issuer doesn't support Acknowledge for this alert"
                  : 'Send PGN 126984 Alert Response to clear'
              }
            >
              {busyKey === a.key ? 'Sending…' : 'Clear'}
            </button>
          </div>
        );
      })}
      {error && <div className="text-xs text-red-300">{error}</div>}
    </div>
  );
}
