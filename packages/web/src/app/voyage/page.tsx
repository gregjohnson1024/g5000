'use client';
import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import {
  UTC_CLOCK,
  fmtHourLabel,
  fmtTimestamp,
  formatDuration,
  type ShipClock,
} from '../../lib/tz';
import { useShipClock } from '../../lib/use-ship-clock';
import { bearingDeg, greatCircleNm } from '../../lib/geo';
import { fmtLatLonDmm } from '../../lib/coords';
import { EnginePanel } from './EnginePanel';
import { TimeSeriesPanel } from '../../components/charts';

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

/**
 * Bermuda reference for the "distance to/from Bermuda" tile.
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
  // App-wide ship clock (boat-synced; replaces the old per-page toggle and
  // its passage:tz localStorage key).
  const clock = useShipClock();

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
    <main className="page-main p-4 flex-1 overflow-y-auto bg-canvas space-y-4">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <h1 className="text-[1.111rem] font-semibold text-ink-value">Passage</h1>
        <div className="flex items-center gap-3">
          {stats?.trackId && (
            <div className="text-caption text-ink-3 font-mono">
              {stats.trackId}
              {stats.trackStartAt &&
                ` · ${formatDuration((stats.lastPointAt ?? Date.now() / 1000) - stats.trackStartAt)} elapsed`}
            </div>
          )}
        </div>
      </div>

      {error && (
        <div className="text-danger text-body-sm bg-danger/10 border border-danger-strong [border-radius:var(--r-panel)] p-2">
          {error}
        </div>
      )}

      {!stats?.trackId && !error && (
        <div className="text-ink-2 text-body-sm">
          No active track. Start one on {/* Fixed: was /tracks (dead link); now /voyage/logbook */}
          <Link href="/voyage/logbook" className="underline hover:text-ink">
            Logbook
          </Link>
          .
        </div>
      )}

      {stats?.trackId && (
        <>
          {eta && <EtaTile eta={eta} clock={clock} log={log} />}

          {eta && <BermudaTile eta={eta} />}

          {log && <LogTile log={log} clock={clock} onReset={resetLog} resetting={resetting} />}

          <section className="grid grid-cols-2 md:grid-cols-5 gap-3">
            <DistanceTile label="Last 1 h" valueNm={stats.d1hM * M_TO_NM} hours={1} />
            <DistanceTile label="Last 3 h" valueNm={stats.d3hM * M_TO_NM} hours={3} />
            <DistanceTile label="Last 6 h" valueNm={stats.d6hM * M_TO_NM} hours={6} />
            <DistanceTile label="Last 12 h" valueNm={stats.d12hM * M_TO_NM} hours={12} />
            <DistanceTile label="Last 24 h" valueNm={stats.d24hM * M_TO_NM} hours={24} highlight />
          </section>

          {stats.daily7.length > 0 && (
            <section className="space-y-2">
              <h2 className="text-label uppercase tracking-wider text-ink-2">
                Previous 7 UTC-days (midnight to midnight)
              </h2>
              <div className="grid grid-cols-2 md:grid-cols-7 gap-2">
                {stats.daily7.map((d) => (
                  <DailyTile key={d.startsAt} bucket={d} clock={clock} />
                ))}
              </div>
            </section>
          )}

          {/* 24h rolling history sparkline via TimeSeriesPanel */}
          <Sparkline24h data={stats.history24h} clock={clock} />
        </>
      )}

      <EnginePanel clock={clock} />
    </main>
  );
}

// ---------------------------------------------------------------------------
// 24h rolling history sparkline — migrated to TimeSeriesPanel
// ---------------------------------------------------------------------------

function Sparkline24h({
  data,
  clock,
}: {
  data: Array<{ endingAt: number; d24hM: number }>;
  clock: ShipClock;
}) {
  if (data.length < 2) {
    return (
      <div className="text-caption text-ink-3 italic">
        Need &ge; 24 h of track for a 24h-rolling history. ({data.length} bucket
        {data.length === 1 ? '' : 's'} so far.)
      </div>
    );
  }

  // History is newest-first from the API. Reverse for left-to-right time order.
  const series = [...data].reverse();
  const tMin = series[0]!.endingAt;
  const tMax = series[series.length - 1]!.endingAt;
  const points = series.map((d) => ({ tMs: d.endingAt, v: d.d24hM * M_TO_NM }));

  const tMinLabel = fmtHourLabel(tMin, clock);
  const tMaxLabel = fmtHourLabel(tMax, clock);

  return (
    <section className="space-y-1">
      <h2 className="text-label uppercase tracking-wider text-ink-2">
        24 h rolling (per hour, since track start)
      </h2>
      <TimeSeriesPanel
        title="24h rolling NM"
        unit="NM"
        series={[
          {
            id: 'rolling24h',
            label: '24h NM',
            color: 'var(--accent-ink)',
            points,
          },
        ]}
        tMin={tMin}
        tMax={tMax}
        height={80}
        valueFmt={(v) => v.toFixed(1)}
      />
      <div className="flex justify-between text-caption text-ink-3 font-mono px-1">
        <span>{tMinLabel}</span>
        <span>{tMaxLabel}</span>
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Cumulative sparkline — migrated to TimeSeriesPanel
// ---------------------------------------------------------------------------

function CumulativeSparkline({
  anchorAt,
  history,
  clock,
}: {
  anchorAt: number;
  history: Array<{ t: number; cumulativeM: number }>;
  clock: ShipClock;
}) {
  if (history.length < 2) {
    return (
      <div className="text-caption text-ink-3 italic">
        Sparkline appears once at least an hour of travel has accumulated.
      </div>
    );
  }

  // Prepend (anchorAt, 0) so the curve starts at the baseline
  const rawPoints = [{ t: anchorAt, cumulativeM: 0 }, ...history];
  const points = rawPoints.map((d) => ({ tMs: d.t * 1000, v: d.cumulativeM * M_TO_NM }));
  const tMin = points[0]!.tMs;
  const tMax = points[points.length - 1]!.tMs;

  // fmtHourLabel takes UNIX seconds (t is seconds; only tMs above is ms).
  const tMinLabel = fmtHourLabel(anchorAt, clock);
  const tMaxLabel = fmtHourLabel(history[history.length - 1]!.t, clock);
  const latestNm = (history[history.length - 1]!.cumulativeM * M_TO_NM).toFixed(1);

  return (
    <div className="space-y-1">
      <TimeSeriesPanel
        title="Cumulative NM"
        unit="NM"
        series={[
          {
            id: 'cumulative',
            label: 'Cumulative NM',
            color: 'var(--ok)',
            points,
          },
        ]}
        tMin={tMin}
        tMax={tMax}
        domain={[0, parseFloat(latestNm) * 1.1 || 1]}
        height={80}
        valueFmt={(v) => v.toFixed(1)}
      />
      <div className="flex justify-between text-caption text-ink-3 font-mono px-1">
        <span>{tMinLabel}</span>
        <span>0 → {latestNm} NM cumulative</span>
        <span>{tMaxLabel}</span>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// DailyTile
// ---------------------------------------------------------------------------

function DailyTile({
  bucket,
  clock,
}: {
  bucket: {
    startsAt: number;
    endsAt: number;
    distanceM: number;
    complete: boolean;
  };
  clock: ShipClock;
}) {
  const nm = bucket.distanceM * M_TO_NM;
  // Shift by the ship offset, then read UTC parts (never the device zone).
  const startsD = new Date((bucket.startsAt + clock.offsetMin * 60) * 1000);
  const label = `${String(startsD.getUTCDate()).padStart(2, '0')} ${startsD.toLocaleString('en-GB', { month: 'short', timeZone: 'UTC' })}`;
  return (
    <div
      className={`[border-radius:var(--r-panel)] p-2 border flex flex-col gap-0.5 ${
        bucket.complete
          ? 'bg-surface border-hairline'
          : 'bg-surface/50 border-hairline border-dashed'
      }`}
      title={bucket.complete ? 'Full 24 h bucket' : 'Partial — bucket extends before track start'}
    >
      <div className="text-label uppercase tracking-wider text-ink-2">{label}</div>
      <div className="flex items-baseline gap-1">
        <div className="text-[1.5rem] font-mono tabular-nums text-ink-value">{nm.toFixed(1)}</div>
        <div className="text-caption text-ink-2">NM</div>
      </div>
      <div className="text-caption text-ink-3 font-mono tabular-nums">
        avg {(nm / 24).toFixed(2)} NM/h{bucket.complete ? '' : ' · partial'}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// DistanceTile
// ---------------------------------------------------------------------------

function DistanceTile({
  label,
  valueNm,
  hours,
  highlight = false,
}: {
  label: string;
  valueNm: number;
  hours: number;
  highlight?: boolean;
}) {
  const avgKn = valueNm / hours;
  return (
    <div
      className={`[border-radius:var(--r-panel)] p-4 flex flex-col gap-1 border ${
        highlight ? 'bg-accent/10 border-accent' : 'bg-surface border-hairline'
      }`}
    >
      <div className="text-label uppercase tracking-wider text-ink-2">{label}</div>
      <div className="flex items-baseline gap-1">
        <div className="text-[1.875rem] font-mono tabular-nums text-ink-value">
          {valueNm.toFixed(1)}
        </div>
        <div className="text-body-sm text-ink-2">NM</div>
      </div>
      <div className="text-body-sm text-ink-2 font-mono tabular-nums">
        avg {avgKn.toFixed(2)} NM/h
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// BermudaTile
// ---------------------------------------------------------------------------

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
    <section className="bg-surface border border-info [border-radius:var(--r-panel)] p-4 flex items-baseline justify-between gap-4 flex-wrap">
      <div>
        <div className="text-label uppercase tracking-wider text-info">From</div>
        <div className="text-[1.111rem] font-semibold text-ink-value">{BERMUDA.label}</div>
        <div className="text-caption text-ink-3 font-mono">
          {fmtLatLonDmm(BERMUDA.lat, BERMUDA.lon)}
        </div>
      </div>
      <div className="text-right">
        <div className="flex items-baseline gap-1 justify-end">
          <div className="text-[2.25rem] font-mono tabular-nums text-ink-value">
            {distNm.toFixed(1)}
          </div>
          <div className="text-body-sm text-ink-2">NM</div>
        </div>
        <div className="text-caption text-ink-3 font-mono">
          bearing to Bermuda {String(Math.round(brgDeg)).padStart(3, '0')}°T
        </div>
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// LogTile
// ---------------------------------------------------------------------------

function LogTile({
  log,
  clock,
  onReset,
  resetting,
}: {
  log: PassageLogSnapshot;
  clock: ShipClock;
  onReset: () => void;
  resetting: boolean;
}) {
  const distNm = log.distanceM * M_TO_NM;
  const sinceText =
    log.anchorAt !== null
      ? `since ${weekdayFor(log.anchorAt, clock)} ${fmtTimestamp(log.anchorAt, clock)}`
      : 'no anchor set';
  const elapsedText =
    log.anchorAt !== null ? ` · ${formatDuration(Date.now() / 1000 - log.anchorAt)} elapsed` : '';
  return (
    <section className="bg-surface border border-ok [border-radius:var(--r-panel)] p-4 space-y-3">
      <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
        <div className="flex flex-col gap-1">
          <div className="text-label uppercase tracking-wider text-ok">Log</div>
          <div className="flex items-baseline gap-1">
            <div className="text-[2.25rem] font-mono tabular-nums text-ink-value">
              {distNm.toFixed(1)}
            </div>
            <div className="text-body-sm text-ink-2">NM travelled</div>
          </div>
          <div className="text-caption text-ink-3 font-mono">
            {sinceText}
            {elapsedText}
          </div>
        </div>
        <button
          type="button"
          onClick={onReset}
          disabled={resetting}
          className="bg-ok border border-ok-strong text-on-accent disabled:opacity-50 px-4 py-2 [border-radius:var(--r-control)] text-body-sm self-start md:self-auto min-h-[44px]"
        >
          {resetting ? 'Resetting…' : 'Reset to now'}
        </button>
      </div>
      {log.anchorAt !== null && (
        <CumulativeSparkline anchorAt={log.anchorAt} history={log.history} clock={clock} />
      )}
    </section>
  );
}

// ---------------------------------------------------------------------------
// EtaTile
// ---------------------------------------------------------------------------

function EtaTile({
  eta,
  clock,
  log,
}: {
  eta: EtaSnapshot;
  clock: ShipClock;
  log: PassageLogSnapshot | null;
}) {
  return (
    <section className="bg-surface border border-accent [border-radius:var(--r-panel)] p-4 space-y-3">
      <div className="flex items-baseline justify-between gap-4 flex-wrap">
        <div>
          <div className="text-label uppercase tracking-wider text-accent-ink">ETA</div>
          <div className="text-[1.111rem] font-semibold text-ink-value">{eta.destinationLabel}</div>
          <div className="text-caption text-ink-3 font-mono">
            {fmtLatLonDmm(eta.destinationLat, eta.destinationLon)}
          </div>
        </div>
        <div className="text-right">
          <div className="flex items-baseline gap-1 justify-end">
            <div className="text-[2.25rem] font-mono tabular-nums text-ink-value">
              {eta.distanceNm.toFixed(1)}
            </div>
            <div className="text-body-sm text-ink-2">NM remaining</div>
          </div>
          <div className="text-caption text-ink-3 font-mono">
            bearing {eta.bearingDeg.toFixed(0)}°T
          </div>
        </div>
      </div>
      <div className="grid grid-cols-2 gap-3 text-body-sm font-mono">
        <div>
          <div className="text-label uppercase tracking-wider text-ink-3">Avg speed (last 3 h)</div>
          <div className="text-[1.25rem] tabular-nums text-ink-value">
            {eta.avgSpeedKn3h !== null ? `${eta.avgSpeedKn3h.toFixed(2)} kn` : '—'}
          </div>
        </div>
        <div>
          <div className="text-label uppercase tracking-wider text-ink-3">Time remaining</div>
          <div className="text-[1.25rem] tabular-nums text-ink-value">
            {eta.etaSecRemaining !== null ? formatDuration(eta.etaSecRemaining) : '—'}
          </div>
        </div>
      </div>
      <div className="text-body font-mono tabular-nums text-ink-value">
        {eta.etaUnixSec !== null
          ? `${weekdayFor(eta.etaUnixSec, clock)} ${fmtTimestamp(eta.etaUnixSec, clock)}`
          : '— stopped, no ETA'}
        {eta.etaUnixSec !== null && clock.mode === 'ship' && (
          <span className="text-caption text-ink-3 ml-2">
            ({weekdayFor(eta.etaUnixSec, UTC_CLOCK)} {fmtTimestamp(eta.etaUnixSec, UTC_CLOCK)})
          </span>
        )}
      </div>
      {log && log.anchorAt !== null && (
        <CumulativeSparkline anchorAt={log.anchorAt} history={log.history} clock={clock} />
      )}
    </section>
  );
}

function weekdayFor(unixSec: number, clock: ShipClock): string {
  // Shift by the ship offset, then read in UTC (never the device zone).
  return new Date((unixSec + clock.offsetMin * 60) * 1000).toLocaleString('en-US', {
    weekday: 'short',
    timeZone: 'UTC',
  });
}
