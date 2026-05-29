'use client';
import { useCallback, useEffect, useState } from 'react';
import {
  fmtHourLabel,
  fmtTimestamp,
  formatDuration,
  readTzMode,
  writeTzMode,
  type TzMode,
} from '../../lib/tz';
import { bearingDeg, greatCircleNm } from '../../lib/geo';
import { TzToggle } from '../../components/TzToggle';
import { fmtLatLonDmm } from '../../lib/format-coords';
import { EnginePanel } from './EnginePanel';

interface EtaSnapshot {
  destinationLat: number;
  destinationLon: number;
  destinationLabel: string;
  distanceNm: number;
  bearingDeg: number;
  avgSpeedKn3h: number | null;
  etaUnixSec: number | null;
  etaSecRemaining: number | null;
  currentLat: number;
  currentLon: number;
  currentAtUnixSec: number;
}

const M_TO_NM = 1 / 1852;
const TZ_KEY = 'passage:tz';

/**
 * Bermuda reference for the "distance to/from Bermuda" tile. St George's
 * Town Cut entrance is the customary departure / clearance point for any
 * passage to the US East Coast or transatlantic, so it's the right anchor
 * for "how far back to Bermuda" thinking. At passage range the choice of
 * Bermuda landmark only matters to a couple of NM (the island is ~22 NM
 * long); this is precise enough for return-decision purposes.
 */
const BERMUDA = {
  lat: 32 + 22.7 / 60,
  lon: -(64 + 40.2 / 60),
  label: "St George's, Bermuda",
};

interface DistanceStats {
  d1hM: number;
  d3hM: number;
  d6hM: number;
  d12hM: number;
  d24hM: number;
  lastPointAt: number | null;
  trackId: string | null;
  trackStartAt: number | null;
  history24h: Array<{ endingAt: number; d24hM: number }>;
  daily7: Array<{
    startsAt: number;
    endsAt: number;
    distanceM: number;
    complete: boolean;
  }>;
}

function Sparkline({
  data,
  tz,
  width = 600,
  height = 60,
}: {
  data: Array<{ endingAt: number; d24hM: number }>;
  tz: TzMode;
  width?: number;
  height?: number;
}) {
  if (data.length < 2) {
    return (
      <div className="text-xs text-slate-500 italic">
        Need ≥ 24 h of track for a 24h-rolling history. ({data.length} bucket
        {data.length === 1 ? '' : 's'} so far.)
      </div>
    );
  }
  // History is newest-first from the API. Reverse for left-to-right time order.
  const series = [...data].reverse();
  const xs = series.map((d) => d.endingAt);
  const ys = series.map((d) => d.d24hM * M_TO_NM);
  const xMin = xs[0]!;
  const xMax = xs[xs.length - 1]!;
  const yMin = Math.min(...ys);
  const yMax = Math.max(...ys);
  const padY = (yMax - yMin) * 0.1 || 1;
  const yLo = yMin - padY;
  const yHi = yMax + padY;
  const px = (x: number): number => ((x - xMin) / Math.max(1, xMax - xMin)) * (width - 24) + 12;
  const py = (y: number): number =>
    height - 12 - ((y - yLo) / Math.max(0.0001, yHi - yLo)) * (height - 24);
  const path = series
    .map((d, i) => {
      const x = px(d.endingAt);
      const y = py(d.d24hM * M_TO_NM);
      return `${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(' ');
  const lastNm = ys[ys.length - 1]!.toFixed(1);
  return (
    <div className="space-y-1">
      <svg
        viewBox={`0 0 ${width} ${height}`}
        width="100%"
        height={height}
        className="bg-slate-900 border border-slate-800 rounded"
      >
        <path d={path} fill="none" stroke="#fbbf24" strokeWidth="1.5" />
        {series.map((d, i) => (
          <circle
            key={d.endingAt}
            cx={px(d.endingAt)}
            cy={py(d.d24hM * M_TO_NM)}
            r={i === series.length - 1 ? 2.5 : 1}
            fill="#fbbf24"
          />
        ))}
      </svg>
      <div className="flex justify-between text-[10px] text-slate-500 font-mono px-1">
        <span>{fmtHourLabel(xMin, tz)}</span>
        <span>
          range {yMin.toFixed(0)}–{yMax.toFixed(0)} NM · latest {lastNm} NM
        </span>
        <span>{fmtHourLabel(xMax, tz)}</span>
      </div>
    </div>
  );
}

interface PassageLogSnapshot {
  anchorAt: number | null;
  distanceM: number;
  /** Cumulative-distance buckets from anchor to now. Empty if no anchor. */
  history: Array<{ t: number; cumulativeM: number }>;
}

export default function PassagePage() {
  const [stats, setStats] = useState<DistanceStats | null>(null);
  const [eta, setEta] = useState<EtaSnapshot | null>(null);
  const [log, setLog] = useState<PassageLogSnapshot | null>(null);
  const [resetting, setResetting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Page-level timezone preference — controls how every timestamp on this
  // page is displayed AND how datetime-local form inputs are interpreted.
  // Default Local (matches /chart and what the user prefers for passage
  // planning); persisted to localStorage so the choice sticks across reloads.
  const [tz, setTz] = useState<TzMode>('local');
  useEffect(() => {
    setTz(readTzMode(TZ_KEY, 'local'));
  }, []);
  useEffect(() => {
    writeTzMode(TZ_KEY, tz);
  }, [tz]);

  useEffect(() => {
    let cancelled = false;
    const tick = async (): Promise<void> => {
      try {
        const [distR, etaR, logR] = await Promise.all([
          fetch('/api/stats/distance', { cache: 'no-store' }),
          fetch('/api/stats/eta', { cache: 'no-store' }),
          fetch('/api/passage/log', { cache: 'no-store' }),
        ]);
        const distJ = (await distR.json()) as
          | { ok: true; stats: DistanceStats }
          | { ok: false; error?: { message?: string } };
        const etaJ = (await etaR.json()) as
          | { ok: true; eta: EtaSnapshot }
          | { ok: false; error?: { message?: string } };
        const logJ = (await logR.json()) as
          | { ok: true; log: PassageLogSnapshot }
          | { ok: false; error?: { message?: string } };
        if (cancelled) return;
        if (distJ.ok) {
          setStats(distJ.stats);
          setError(null);
        } else {
          setError(distJ.error?.message ?? 'unknown error');
        }
        setEta(etaJ.ok ? etaJ.eta : null);
        setLog(logJ.ok ? logJ.log : null);
      } catch (e) {
        if (!cancelled) setError(String(e));
      }
    };
    void tick();
    const id = setInterval(tick, 5000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, []);

  const resetLog = useCallback(async (): Promise<void> => {
    setResetting(true);
    try {
      const r = await fetch('/api/passage/log', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ resetToNow: true }),
      });
      const j = (await r.json()) as
        | { ok: true; log: PassageLogSnapshot }
        | { ok: false; error?: { message?: string } };
      if (j.ok) setLog(j.log);
      else setError(j.error?.message ?? 'reset failed');
    } catch (e) {
      setError(String(e));
    } finally {
      setResetting(false);
    }
  }, []);

  return (
    <main className="p-4 flex-1 overflow-y-auto bg-black space-y-4">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <h1 className="text-xl font-semibold text-slate-300">Passage</h1>
        <div className="flex items-center gap-3">
          <TzToggle tz={tz} setTz={setTz} />
          {stats?.trackId && (
            <div className="text-xs text-slate-500 font-mono">
              {stats.trackId}
              {stats.trackStartAt &&
                ` · ${formatDuration((stats.lastPointAt ?? Date.now() / 1000) - stats.trackStartAt)} elapsed`}
            </div>
          )}
        </div>
      </div>

      {error && (
        <div className="text-rose-400 text-sm bg-rose-900/20 border border-rose-800 rounded p-2">
          {error}
        </div>
      )}

      {!stats?.trackId && !error && (
        <div className="text-slate-400 text-sm">
          No active track. Start one on{' '}
          <a href="/tracks" className="underline hover:text-slate-200">
            /tracks
          </a>
          .
        </div>
      )}

      {stats?.trackId && (
        <>
          {eta && <EtaTile eta={eta} tz={tz} log={log} />}

          {eta && <BermudaTile eta={eta} />}

          {log && <LogTile log={log} tz={tz} onReset={resetLog} resetting={resetting} />}

          <section className="grid grid-cols-2 md:grid-cols-5 gap-3">
            <DistanceTile label="Last 1 h" valueNm={stats.d1hM * M_TO_NM} hours={1} />
            <DistanceTile label="Last 3 h" valueNm={stats.d3hM * M_TO_NM} hours={3} />
            <DistanceTile label="Last 6 h" valueNm={stats.d6hM * M_TO_NM} hours={6} />
            <DistanceTile label="Last 12 h" valueNm={stats.d12hM * M_TO_NM} hours={12} />
            <DistanceTile label="Last 24 h" valueNm={stats.d24hM * M_TO_NM} hours={24} highlight />
          </section>

          {stats.daily7.length > 0 && (
            <section className="space-y-2">
              <h2 className="text-sm font-semibold text-slate-400 uppercase tracking-wider">
                Previous 7 UTC-days (midnight to midnight)
              </h2>
              <div className="grid grid-cols-2 md:grid-cols-7 gap-2">
                {stats.daily7.map((d) => (
                  <DailyTile key={d.startsAt} bucket={d} tz={tz} />
                ))}
              </div>
            </section>
          )}

          <section className="space-y-2">
            <h2 className="text-sm font-semibold text-slate-400 uppercase tracking-wider">
              24 h rolling (per hour, since track start)
            </h2>
            <Sparkline data={stats.history24h} tz={tz} />
          </section>
        </>
      )}

      <EnginePanel tz={tz} />
    </main>
  );
}

function DailyTile({
  bucket,
  tz,
}: {
  bucket: {
    startsAt: number;
    endsAt: number;
    distanceM: number;
    complete: boolean;
  };
  tz: TzMode;
}) {
  const nm = bucket.distanceM * M_TO_NM;
  const startsD = new Date(bucket.startsAt * 1000);
  // The "label" for the bucket is the calendar date of `startsAt` —
  // matches the marine convention of "today's run" = midnight-to-midnight
  // of the date you started.
  const label =
    tz === 'utc'
      ? `${String(startsD.getUTCDate()).padStart(2, '0')} ${startsD.toLocaleString('en-GB', { month: 'short', timeZone: 'UTC' })}`
      : `${String(startsD.getDate()).padStart(2, '0')} ${startsD.toLocaleString('en-GB', { month: 'short' })}`;
  return (
    <div
      className={`rounded p-2 border flex flex-col gap-0.5 ${
        bucket.complete
          ? 'bg-slate-900 border-slate-800'
          : 'bg-slate-900/50 border-slate-800 border-dashed'
      }`}
      title={bucket.complete ? 'Full 24 h bucket' : 'Partial — bucket extends before track start'}
    >
      <div className="text-xs uppercase tracking-wider text-slate-400">{label}</div>
      <div className="flex items-baseline gap-1">
        <div className="text-2xl font-mono text-slate-100">{nm.toFixed(1)}</div>
        <div className="text-xs text-slate-400">NM</div>
      </div>
      <div className="text-[10px] text-slate-500 font-mono">
        avg {(nm / 24).toFixed(2)} NM/h{bucket.complete ? '' : ' · partial'}
      </div>
    </div>
  );
}

function DistanceTile({
  label,
  valueNm,
  hours,
  highlight = false,
}: {
  label: string;
  valueNm: number;
  /** Window length in hours; used to compute the avg-speed subtitle. */
  hours: number;
  highlight?: boolean;
}) {
  const avgKn = valueNm / hours;
  return (
    <div
      className={`rounded p-4 flex flex-col gap-1 border ${
        highlight ? 'bg-amber-900/20 border-amber-700' : 'bg-slate-900 border-slate-800'
      }`}
    >
      <div className="text-xs uppercase tracking-wider text-slate-400">{label}</div>
      <div className="flex items-baseline gap-1">
        <div className="text-3xl font-mono text-slate-100">{valueNm.toFixed(1)}</div>
        <div className="text-sm text-slate-400">NM</div>
      </div>
      <div className="text-base text-slate-400 font-mono">avg {avgKn.toFixed(2)} NM/h</div>
    </div>
  );
}

function BermudaTile({ eta }: { eta: EtaSnapshot }) {
  const distNm = greatCircleNm(
    { lat: eta.currentLat, lon: eta.currentLon },
    { lat: BERMUDA.lat, lon: BERMUDA.lon },
  );
  const brgDeg = bearingDeg(
    { lat: eta.currentLat, lon: eta.currentLon },
    { lat: BERMUDA.lat, lon: BERMUDA.lon },
  );
  return (
    <section className="bg-slate-900 border border-cyan-700 rounded p-4 flex items-baseline justify-between gap-4 flex-wrap">
      <div>
        <div className="text-xs uppercase tracking-wider text-cyan-400">From</div>
        <div className="text-lg font-semibold text-slate-100">{BERMUDA.label}</div>
        <div className="text-xs text-slate-500 font-mono">
          {fmtLatLonDmm(BERMUDA.lat, BERMUDA.lon)}
        </div>
      </div>
      <div className="text-right">
        <div className="flex items-baseline gap-1 justify-end">
          <div className="text-4xl font-mono text-slate-100">{distNm.toFixed(1)}</div>
          <div className="text-sm text-slate-400">NM</div>
        </div>
        <div className="text-xs text-slate-500 font-mono">
          bearing to Bermuda {String(Math.round(brgDeg)).padStart(3, '0')}°T
        </div>
      </div>
    </section>
  );
}

function LogTile({
  log,
  tz,
  onReset,
  resetting,
}: {
  log: PassageLogSnapshot;
  tz: TzMode;
  onReset: () => void;
  resetting: boolean;
}) {
  const distNm = log.distanceM * M_TO_NM;
  const sinceText =
    log.anchorAt !== null
      ? `since ${weekdayFor(log.anchorAt, tz)} ${fmtTimestamp(log.anchorAt, tz)}`
      : 'no anchor set';
  const elapsedText =
    log.anchorAt !== null ? ` · ${formatDuration(Date.now() / 1000 - log.anchorAt)} elapsed` : '';
  return (
    <section className="bg-slate-900 border border-emerald-700 rounded p-4 space-y-3">
      <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
        <div className="flex flex-col gap-1">
          <div className="text-xs uppercase tracking-wider text-emerald-400">Log</div>
          <div className="flex items-baseline gap-1">
            <div className="text-4xl font-mono text-slate-100">{distNm.toFixed(1)}</div>
            <div className="text-sm text-slate-400">NM travelled</div>
          </div>
          <div className="text-xs text-slate-500 font-mono">
            {sinceText}
            {elapsedText}
          </div>
        </div>
        <button
          type="button"
          onClick={onReset}
          disabled={resetting}
          className="bg-emerald-700 hover:bg-emerald-600 disabled:bg-slate-700 text-white px-4 py-2 rounded text-sm self-start md:self-auto"
        >
          {resetting ? 'Resetting…' : 'Reset to now'}
        </button>
      </div>
      {log.anchorAt !== null && (
        <CumulativeSparkline anchorAt={log.anchorAt} history={log.history} tz={tz} />
      )}
    </section>
  );
}

function CumulativeSparkline({
  anchorAt,
  history,
  tz,
  width = 600,
  height = 60,
}: {
  anchorAt: number;
  history: Array<{ t: number; cumulativeM: number }>;
  tz: TzMode;
  width?: number;
  height?: number;
}) {
  if (history.length < 2) {
    return (
      <div className="text-xs text-slate-500 italic">
        Sparkline appears once at least an hour of travel has accumulated.
      </div>
    );
  }
  // Always start the curve at (anchorAt, 0) so the slope from the origin
  // is visible — otherwise the first bucket starts mid-air and the user
  // can't see the zero baseline.
  const series = [{ t: anchorAt, cumulativeM: 0 }, ...history];
  const xs = series.map((d) => d.t);
  const ys = series.map((d) => d.cumulativeM * M_TO_NM);
  const xMin = xs[0]!;
  const xMax = xs[xs.length - 1]!;
  // Cumulative distance starts at 0 by construction; clamp yLo to 0 so the
  // baseline is always at the bottom even if the boat has barely moved.
  const yMax = Math.max(...ys);
  const padY = yMax * 0.1 || 1;
  const yHi = yMax + padY;
  const px = (x: number): number => ((x - xMin) / Math.max(1, xMax - xMin)) * (width - 24) + 12;
  const py = (y: number): number => height - 12 - (y / Math.max(0.0001, yHi)) * (height - 24);
  const path = series
    .map((d, i) => {
      const x = px(d.t);
      const y = py(d.cumulativeM * M_TO_NM);
      return `${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(' ');
  const latestNm = ys[ys.length - 1]!.toFixed(1);
  return (
    <div className="space-y-1">
      <svg
        viewBox={`0 0 ${width} ${height}`}
        width="100%"
        height={height}
        className="bg-slate-950 border border-slate-800 rounded"
      >
        <path d={path} fill="none" stroke="#34d399" strokeWidth="1.5" />
        <circle cx={px(xMax)} cy={py(ys[ys.length - 1]!)} r={2.5} fill="#34d399" />
      </svg>
      <div className="flex justify-between text-[10px] text-slate-500 font-mono px-1">
        <span>{fmtHourLabel(xMin, tz)}</span>
        <span>0 → {latestNm} NM cumulative</span>
        <span>{fmtHourLabel(xMax, tz)}</span>
      </div>
    </div>
  );
}

function weekdayFor(unixSec: number, tz: TzMode): string {
  return new Date(unixSec * 1000).toLocaleString('en-US', {
    weekday: 'short',
    timeZone: tz === 'utc' ? 'UTC' : undefined,
  });
}

function EtaTile({
  eta,
  tz,
  log,
}: {
  eta: EtaSnapshot;
  tz: TzMode;
  log: PassageLogSnapshot | null;
}) {
  const altTz: TzMode = tz === 'utc' ? 'local' : 'utc';
  return (
    <section className="bg-slate-900 border border-amber-700 rounded p-4 space-y-3">
      <div className="flex items-baseline justify-between gap-4 flex-wrap">
        <div>
          <div className="text-xs uppercase tracking-wider text-amber-400">ETA</div>
          <div className="text-lg font-semibold text-slate-100">{eta.destinationLabel}</div>
          <div className="text-xs text-slate-500 font-mono">
            {fmtLatLonDmm(eta.destinationLat, eta.destinationLon)}
          </div>
        </div>
        <div className="text-right">
          <div className="flex items-baseline gap-1 justify-end">
            <div className="text-4xl font-mono text-slate-100">{eta.distanceNm.toFixed(1)}</div>
            <div className="text-sm text-slate-400">NM remaining</div>
          </div>
          <div className="text-xs text-slate-500 font-mono">
            bearing {eta.bearingDeg.toFixed(0)}°T
          </div>
        </div>
      </div>
      <div className="grid grid-cols-2 gap-3 text-sm font-mono">
        <div>
          <div className="text-xs uppercase tracking-wider text-slate-500">
            Avg speed (last 3 h)
          </div>
          <div className="text-xl text-slate-100">
            {eta.avgSpeedKn3h !== null ? `${eta.avgSpeedKn3h.toFixed(2)} kn` : '—'}
          </div>
        </div>
        <div>
          <div className="text-xs uppercase tracking-wider text-slate-500">Time remaining</div>
          <div className="text-xl text-slate-100">
            {eta.etaSecRemaining !== null ? formatDuration(eta.etaSecRemaining) : '—'}
          </div>
        </div>
      </div>
      <div className="text-base font-mono text-slate-100">
        {eta.etaUnixSec !== null
          ? `${weekdayFor(eta.etaUnixSec, tz)} ${fmtTimestamp(eta.etaUnixSec, tz)}`
          : '— stopped, no ETA'}
        {eta.etaUnixSec !== null && (
          <span className="text-xs text-slate-500 ml-2">
            ({weekdayFor(eta.etaUnixSec, altTz)} {fmtTimestamp(eta.etaUnixSec, altTz)})
          </span>
        )}
      </div>
      {log && log.anchorAt !== null && (
        <CumulativeSparkline anchorAt={log.anchorAt} history={log.history} tz={tz} />
      )}
    </section>
  );
}
