'use client';

import { useCallback, useEffect, useRef, useState, type ReactElement } from 'react';
import type { JsonSafeSample } from '@g5000/core';
import type { SailWardrobe } from '@g5000/db';
import { useSse } from '../../hooks/use-sse';
import { HelmTile } from './HelmTile';
import { MobButton } from './MobButton';
import { SailRecommendationTile } from './SailRecommendationTile';
import { AudibleAlarm } from '../../components/AudibleAlarm';
import { RaceMiniTimer } from './RaceMiniTimer';
import { RaceTiles } from '../../components/RaceTiles';

const MS_TO_KNOTS = 1 / 0.514444;
const RAD_TO_DEG = 180 / Math.PI;

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

  // In v3 (atomic sails) there's no single active "config"; each category
  // (headsail / main / downwind) has its own active sail. The /sails page
  // is the canonical UI for swapping; helm just renders the current state.

  const sog = channels.get('nav.gps.sog');
  // Wind + race-derived channels — rendered conditionally; tiles appear only when the channel publishes.
  const tws = channels.get('wind.true.speed');
  const twa = channels.get('wind.true.angle');
  const awa = channels.get('wind.apparent.angle');
  const aws = channels.get('wind.apparent.speed');
  const tbsSample = channels.get('race.targetSpeed');
  const tTwaSample = channels.get('race.targetTwa');
  const pctPolarSample = channels.get('race.percentPolar');
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

  // Rolling-window SOG mean comes from /api/stats/sog. The autopilot-server
  // owns the buffer (see apps/autopilot-server/src/sog-stats.ts), so it
  // survives client navigation — switching tabs doesn't reset the average.
  // Poll every 2 s; the window is whatever the server reports.
  const [avgSog, setAvgSog] = useState<{
    ms: number;
    coveredMs: number;
    windowMs: number;
  } | null>(null);
  // Same pattern for COG — circular-mean computed server-side, so a boat
  // crossing 0° doesn't average to 180°. `concentration` is the
  // mean-resultant length; near 0 means the average isn't statistically
  // meaningful (used to grey out the tile).
  const [avgCog, setAvgCog] = useState<{
    rad: number;
    concentration: number;
    coveredMs: number;
    windowMs: number;
  } | null>(null);
  const [avgHdg, setAvgHdg] = useState<{
    rad: number;
    concentration: number;
    coveredMs: number;
    windowMs: number;
  } | null>(null);
  const [motion, setMotion] = useState<{
    heelRmsRad: number | null;
    pitchRmsRad: number | null;
    combinedRmsRad: number | null;
    coveredMs: number;
    windowMs: number;
  } | null>(null);
  useEffect(() => {
    let cancelled = false;
    const tick = async (): Promise<void> => {
      try {
        const [sogR, cogR, hdgR, motionR] = await Promise.all([
          fetch('/api/stats/sog', { cache: 'no-store' }),
          fetch('/api/stats/cog', { cache: 'no-store' }),
          fetch('/api/stats/hdg', { cache: 'no-store' }),
          fetch('/api/stats/motion', { cache: 'no-store' }),
        ]);
        if (cancelled) return;
        if (sogR.ok) {
          const j = (await sogR.json()) as {
            ok: boolean;
            stats?: { avgMs: number | null; coveredMs: number; windowMs: number };
          };
          if (j.ok && j.stats && j.stats.avgMs !== null) {
            setAvgSog({
              ms: j.stats.avgMs,
              coveredMs: j.stats.coveredMs,
              windowMs: j.stats.windowMs,
            });
          }
        }
        if (cogR.ok) {
          const j = (await cogR.json()) as {
            ok: boolean;
            stats?: {
              avgRad: number | null;
              concentration: number;
              coveredMs: number;
              windowMs: number;
            };
          };
          if (j.ok && j.stats && j.stats.avgRad !== null) {
            setAvgCog({
              rad: j.stats.avgRad,
              concentration: j.stats.concentration,
              coveredMs: j.stats.coveredMs,
              windowMs: j.stats.windowMs,
            });
          }
        }
        if (hdgR.ok) {
          const j = (await hdgR.json()) as {
            ok: boolean;
            stats?: {
              avgRad: number | null;
              concentration: number;
              coveredMs: number;
              windowMs: number;
            };
          };
          if (j.ok && j.stats && j.stats.avgRad !== null) {
            setAvgHdg({
              rad: j.stats.avgRad,
              concentration: j.stats.concentration,
              coveredMs: j.stats.coveredMs,
              windowMs: j.stats.windowMs,
            });
          }
        }
        if (motionR.ok) {
          const j = (await motionR.json()) as {
            ok: boolean;
            stats?: {
              heelRmsRad: number | null;
              pitchRmsRad: number | null;
              combinedRmsRad: number | null;
              coveredMs: number;
              windowMs: number;
            };
          };
          if (j.ok && j.stats) {
            setMotion({
              heelRmsRad: j.stats.heelRmsRad,
              pitchRmsRad: j.stats.pitchRmsRad,
              combinedRmsRad: j.stats.combinedRmsRad,
              coveredMs: j.stats.coveredMs,
              windowMs: j.stats.windowMs,
            });
          }
        }
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

  return (
    <main className="p-4 min-h-screen bg-black">
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-xl font-semibold text-slate-300">Helm</h1>
        <div className="flex items-center gap-3">
          <RaceMiniTimer />
          <div className="text-xs text-slate-500">{connected ? 'Live' : 'Reconnecting…'}</div>
        </div>
      </div>
      <AlertsPanel />

      {wardrobe && (
        <div className="flex items-center gap-3 mb-3 text-sm bg-slate-900 border border-slate-800 rounded px-3 py-2">
          <span className="text-slate-400">Sails:</span>
          {(['headsail', 'main', 'downwind'] as const).map((cat) => {
            const activeId = wardrobe.active[cat];
            const sail = activeId ? wardrobe.sails.find((s) => s.id === activeId) : undefined;
            return (
              <span key={cat} className="text-xs text-slate-300">
                <span className="text-slate-500">{cat}:</span>{' '}
                <span className="text-slate-200">{sail?.name ?? '—'}</span>
              </span>
            );
          })}
          <a href="/sails" className="text-xs text-slate-500 hover:text-slate-300 underline">
            manage
          </a>
        </div>
      )}

      <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
        <HelmTile label="SOG" value={fmtSpeed(sog)} unit="kn" />
        {/* Wind tiles — render only when the corresponding channel publishes,
            so a missing masthead leaves the grid clean. */}
        {tws && <HelmTile label="TWS" value={fmtSpeed(tws)} unit="kn" />}
        {twa && <HelmTile label="TWA" value={fmtAngleSigned(twa)} unit="°" />}
        {aws && <HelmTile label="AWS" value={fmtSpeed(aws)} unit="kn" small />}
        {awa && <HelmTile label="AWA" value={fmtAngleSigned(awa)} unit="°" small />}
        {tbsSample && <HelmTile label="TBS" value={fmtSpeed(tbsSample)} unit="kn" small />}
        {tTwaSample && (
          <HelmTile label="Target TWA" value={fmtAngleSigned(tTwaSample)} unit="°" small />
        )}
        {pctPolarSample && (
          <HelmTile
            label="% polar"
            value={(() => {
              const v = scalar(pctPolarSample);
              return v === null ? '—' : v.toFixed(0);
            })()}
            unit="%"
            small
          />
        )}
        <HelmTile label="COG" value={fmtHeading(cog)} unit="°" sub={cogRef ?? undefined} />
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
              ? avgSog.coveredMs >= avgSog.windowMs - 1000
                ? `${Math.round(avgSog.windowMs / 60000)} min`
                : `${Math.max(1, Math.round(avgSog.coveredMs / 60000))} min so far`
              : '15 min'
          }
          small
        />

        <HelmTile
          label="Avg COG"
          value={avgCog ? fmtHeadingRad(avgCog.rad) : '—'}
          unit="°"
          sub={
            avgCog
              ? avgCog.coveredMs >= avgCog.windowMs - 1000
                ? `${Math.round(avgCog.windowMs / 60000)} min`
                : `${Math.max(1, Math.round(avgCog.coveredMs / 60000))} min so far`
              : '15 min'
          }
          small
        />

        <HelmTile
          label="Avg HDG"
          value={avgHdg ? fmtHeadingRad(avgHdg.rad) : '—'}
          unit="°"
          sub={
            avgHdg
              ? avgHdg.coveredMs >= avgHdg.windowMs - 1000
                ? `${Math.round(avgHdg.windowMs / 60000)} min`
                : `${Math.max(1, Math.round(avgHdg.coveredMs / 60000))} min so far`
              : '15 min'
          }
          small
        />

        {/* Drift = avg COG − avg HDG, normalised to [-π, π]. Approximates
            the perpendicular component of the current pushing the boat
            sideways. Positive = COG drifted to starboard of HDG (current
            setting starboard). Greyed when either input is missing. */}
        {(() => {
          let driftDeg: number | null = null;
          if (avgCog && avgHdg) {
            let d = avgCog.rad - avgHdg.rad;
            while (d > Math.PI) d -= 2 * Math.PI;
            while (d < -Math.PI) d += 2 * Math.PI;
            driftDeg = (d * 180) / Math.PI;
          }
          const label =
            driftDeg === null ? '—' : `${driftDeg >= 0 ? '+' : ''}${driftDeg.toFixed(1)}`;
          return (
            <HelmTile
              label="Drift (COG−HDG)"
              value={label}
              unit="°"
              sub={driftDeg === null ? '15 min' : driftDeg >= 0 ? 'set stbd' : 'set port'}
              small
            />
          );
        })()}

        {/* Motion: combined RMS of heel + pitch over the 15-min window.
            Higher number = bouncier. Calm = <1°; choppy = 3–6°; rough = 8°+. */}
        <HelmTile
          label="Motion"
          value={
            motion?.combinedRmsRad !== null && motion?.combinedRmsRad !== undefined
              ? ((motion.combinedRmsRad * 180) / Math.PI).toFixed(1)
              : '—'
          }
          unit="°"
          sub={
            motion?.heelRmsRad !== null &&
            motion?.heelRmsRad !== undefined &&
            motion?.pitchRmsRad !== null &&
            motion?.pitchRmsRad !== undefined
              ? `h ${((motion.heelRmsRad * 180) / Math.PI).toFixed(1)}° p ${((motion.pitchRmsRad * 180) / Math.PI).toFixed(1)}°`
              : '15 min'
          }
          small
        />

        <HelmTile label="Heel" value={fmtAngleSigned(heel)} unit="°" small />
        <HelmTile label="Pitch" value={fmtAngleSigned(pitch)} unit="°" small />

        <SailRecommendationTile />

        {/* Position — two stacked coordinates rather than the one-number-per-tile
            idiom every other tile follows. Hemisphere suffixes ride at unit
            size so the magnitudes line up vertically. The Copy button is
            essential here because the live tile redraws every SSE frame —
            text selection drops on every re-render, so the user can't grab
            the coordinates the usual way. */}
        <PositionTile positionLat={positionLat} positionLon={positionLon} />
      </div>
      <RaceTiles />
      <MobButton />
      <AudibleAlarm />
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

/**
 * Position tile with a Copy button. SSE-driven re-renders happen ~5× / sec,
 * which kills any in-progress text selection — making the displayed
 * coordinates effectively un-grabbable by the usual select-and-copy gesture.
 * The button writes the displayed strings verbatim (whatever DMM format
 * fmtLat/fmtLon produce, so what's copied matches exactly what's shown).
 */
function PositionTile({
  positionLat,
  positionLon,
}: {
  positionLat: string | null;
  positionLon: string | null;
}) {
  const [copied, setCopied] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const onCopy = useCallback(async () => {
    if (!positionLat || !positionLon) return;
    const text = `${positionLat}\n${positionLon}`;
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard refused (insecure context / permission) — silent */
    }
  }, [positionLat, positionLon]);
  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);
  return (
    <div className="bg-slate-900 border border-slate-800 rounded p-4 flex flex-col gap-1 col-span-2 relative">
      <div className="flex items-center justify-between">
        <div className="text-xs uppercase tracking-wider text-slate-400">Position</div>
        <button
          type="button"
          onClick={onCopy}
          disabled={!positionLat || !positionLon}
          className="text-xs px-2 py-0.5 rounded bg-slate-800 hover:bg-slate-700 text-slate-300 disabled:opacity-40"
          title="Copy lat / lon to clipboard"
        >
          {copied ? 'copied' : 'copy'}
        </button>
      </div>
      <div className="text-3xl font-mono text-slate-100 leading-tight">
        {positionLat ?? <span className="text-slate-500">—</span>}
      </div>
      <div className="text-3xl font-mono text-slate-100 leading-tight">
        {positionLon ?? <span className="text-slate-500">—</span>}
      </div>
    </div>
  );
}

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
    (a) => a.state !== 'Normal' && a.state !== 'Disabled' && now - a.lastSeenMs < 5000,
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
          <div key={a.key} className={`border rounded p-3 flex items-center gap-3 ${style}`}>
            <div className="flex-1">
              <div className="text-xs uppercase tracking-wide opacity-80">
                {a.type}
                {a.text ? <span className="ml-2 normal-case opacity-100">{a.text}</span> : null}
              </div>
              <div className="text-[10px] opacity-70 mt-0.5 font-mono">{sub}</div>
              {a.location && <div className="text-[10px] opacity-70 italic">{a.location}</div>}
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
