'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { Channels } from '@g5000/core';
import { MultiSourcePlot, PLOT_PALETTE } from '../../../../components/MultiSourcePlot';
import type { PlotSeries } from '../../../../components/MultiSourcePlot';
import { deviceLabel } from '../../../../lib/device-label';
import type { DeviceLabelInfo } from '../../../../lib/device-label';

// ---- Wire shapes (from GET /api/wind-diag/history) ----------------------------

interface HistoryPoint {
  tMs: number;
  v: number;
}

interface HistorySeries {
  channel: string;
  source: string;
  points: HistoryPoint[];
}

interface HistoryResponse {
  windowMs: number;
  series: HistorySeries[];
}

interface DevicesResponse {
  devices: Array<{
    src: number;
    manufacturerName?: string;
    modelId?: string;
    deviceFunctionName?: string;
  }>;
}

// ---- Row config: one stacked plot per channel, in display order --------------

const KN_PER_MS = 1.94384;
const DEG_PER_RAD = 180 / Math.PI;

type Convert = (v: number) => number;
const toKn: Convert = (v) => v * KN_PER_MS;
const toDeg: Convert = (v) => v * DEG_PER_RAD;
const toPct: Convert = (v) => v; // catalog % values pass through

interface RowDef {
  channel: string;
  title: string;
  unit: 'kn' | 'deg' | '%';
  convert: Convert;
}

// AWS, AWA, TWS, TWA, TWD, Heading, STW — fixed display order, raw is SI.
const ROWS: readonly RowDef[] = [
  {
    channel: Channels.Wind.ApparentSpeed,
    title: 'AWS — Apparent Wind Speed',
    unit: 'kn',
    convert: toKn,
  },
  {
    channel: Channels.Wind.ApparentAngle,
    title: 'AWA — Apparent Wind Angle',
    unit: 'deg',
    convert: toDeg,
  },
  { channel: Channels.Wind.TrueSpeed, title: 'TWS — True Wind Speed', unit: 'kn', convert: toKn },
  { channel: Channels.Wind.TrueAngle, title: 'TWA — True Wind Angle', unit: 'deg', convert: toDeg },
  {
    channel: Channels.Wind.TrueDirection,
    title: 'TWD — True Wind Direction',
    unit: 'deg',
    convert: toDeg,
  },
  {
    channel: Channels.Boat.HeadingMagnetic,
    title: 'Heading — Magnetic',
    unit: 'deg',
    convert: toDeg,
  },
  {
    channel: Channels.Boat.SpeedWater,
    title: 'STW — Speed Through Water',
    unit: 'kn',
    convert: toKn,
  },
  // ── H5000's own broadcast (PGN 130824), decoded from the B&G key-value PGN
  //    canboatjs can't read. Compare these against g5000's computed rows above.
  { channel: 'bandg.trueWindDirection', title: 'H5000 TWD', unit: 'deg', convert: toDeg },
  { channel: 'bandg.avgTrueWindDirection', title: 'H5000 TWD (avg)', unit: 'deg', convert: toDeg },
  { channel: 'bandg.trueWindSpeed', title: 'H5000 TWS', unit: 'kn', convert: toKn },
  { channel: 'bandg.trueWindAngle', title: 'H5000 TWA', unit: 'deg', convert: toDeg },
  { channel: 'bandg.targetTwa', title: 'H5000 Target TWA', unit: 'deg', convert: toDeg },
  { channel: 'bandg.targetSpeed', title: 'H5000 Target Speed', unit: 'kn', convert: toKn },
  {
    channel: 'bandg.polarPerformance',
    title: 'H5000 Polar Performance',
    unit: '%',
    convert: toPct,
  },
  { channel: 'bandg.vmgPerformance', title: 'H5000 VMG Performance', unit: '%', convert: toPct },
  { channel: 'bandg.leeway', title: 'H5000 Leeway', unit: 'deg', convert: toDeg },
];

const POLL_MS = 1000;
const DEVICES_POLL_MS = 15000;
const WINDOW_MS = 300000;

const fmt1 = (v: number): string => v.toFixed(1);

export default function WindDiagPage(): React.ReactElement {
  const [history, setHistory] = useState<HistoryResponse | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [devices, setDevices] = useState<Map<number, DeviceLabelInfo>>(new Map());
  // Persistent source→colour assignment so a source keeps its colour across polls.
  const colorRef = useRef<Map<string, string>>(new Map());

  // Poll the per-source history snapshot.
  useEffect(() => {
    let alive = true;
    const tick = async (): Promise<void> => {
      try {
        const res = await fetch(`/api/wind-diag/history?windowMs=${WINDOW_MS}`, {
          cache: 'no-store',
        });
        if (!res.ok) throw new Error(`GET wind-diag history: ${res.status}`);
        const body = (await res.json()) as HistoryResponse;
        if (!alive) return;
        setHistory(body);
        setErr(null);
      } catch (e) {
        if (alive) setErr(e instanceof Error ? e.message : String(e));
      }
    };
    void tick();
    const id = window.setInterval(() => void tick(), POLL_MS);
    return () => {
      alive = false;
      window.clearInterval(id);
    };
  }, []);

  // Load the N2K device registry (for friendly source names). Best-effort:
  // on failure, source labels just fall back to PGN+address.
  useEffect(() => {
    let alive = true;
    const load = async (): Promise<void> => {
      try {
        const res = await fetch('/api/devices', { cache: 'no-store' });
        if (!res.ok) throw new Error(`GET devices: ${res.status}`);
        const body = (await res.json()) as DevicesResponse;
        if (!alive) return;
        const map = new Map<number, DeviceLabelInfo>();
        for (const d of body.devices) {
          map.set(d.src, {
            src: d.src,
            manufacturerName: d.manufacturerName,
            modelId: d.modelId,
            deviceFunctionName: d.deviceFunctionName,
          });
        }
        setDevices(map);
      } catch {
        // Non-fatal — labels fall back to PGN+address.
      }
    };
    void load();
    const id = window.setInterval(() => void load(), DEVICES_POLL_MS);
    return () => {
      alive = false;
      window.clearInterval(id);
    };
  }, []);

  // Derive the shared x-domain, the stable per-source colour map, and the
  // per-row series. Recomputed each poll; memoised on the history+devices refs.
  const { tMin, tMax, rows, hasData } = useMemo(() => {
    const series = history?.series ?? [];

    // Shared x-domain across EVERY point so all rows line up in time.
    let lo = Infinity;
    let hi = -Infinity;
    for (const s of series) {
      for (const p of s.points) {
        if (p.tMs < lo) lo = p.tMs;
        if (p.tMs > hi) hi = p.tMs;
      }
    }
    const hasAny = lo !== Infinity && hi !== -Infinity;
    // Fall back to the configured window ending now when there is no data yet.
    const now = Date.now();
    const domainMin = hasAny ? lo : now - WINDOW_MS;
    const domainMax = hasAny ? hi : now;

    // Stable colour per source, persisted across polls via a ref: a source
    // keeps its colour for the whole session. Genuinely-new sources get the
    // next palette slot; existing assignments are never reshuffled — so a new
    // source appearing mid-session can't re-colour the ones you're tracking,
    // which matters for correlating a jump across panels.
    const colorOf = colorRef.current;
    const fresh = Array.from(new Set(series.map((s) => s.source)))
      .filter((src) => !colorOf.has(src))
      .sort();
    for (const src of fresh) {
      colorOf.set(src, PLOT_PALETTE[colorOf.size % PLOT_PALETTE.length]!);
    }

    const rowsOut = ROWS.map((row) => {
      const plotSeries: PlotSeries[] = series
        .filter((s) => s.channel === row.channel)
        .map((s) => ({
          id: s.source,
          label: deviceLabel(s.source, devices),
          color: colorOf.get(s.source) ?? PLOT_PALETTE[0]!,
          points: s.points.map((p) => ({ tMs: p.tMs, v: row.convert(p.v) })),
        }));
      return { row, series: plotSeries };
    });

    return { tMin: domainMin, tMax: domainMax, rows: rowsOut, hasData: hasAny };
  }, [history, devices]);

  const live = history !== null && err === null;

  return (
    <main className="page-main p-4 bg-canvas min-h-full space-y-4">
      <header>
        <div className="flex items-center gap-3">
          <h1 className="text-xl font-semibold text-slate-100">Wind Diagnostics</h1>
          <span
            className={`inline-flex items-center gap-1.5 text-xs font-medium ${
              live ? 'text-emerald-400' : 'text-amber-400'
            }`}
          >
            <span
              className={`inline-block w-2 h-2 rounded-full ${
                live ? 'bg-emerald-400 animate-pulse' : 'bg-amber-400'
              }`}
            />
            {live ? 'Live' : 'connecting…'}
          </span>
        </div>
        <p className="text-sm text-slate-400 mt-1">
          Raw, un-damped per-source values straight off the N2K bus — one line per source so an
          aberrant or jumpy signal stands out against its peers. Unlike the helm display these are
          not winner-selected or EMA-smoothed. Note that{' '}
          <code className="text-slate-300">wind.true.*</code> is computed by g5000; the H5000
          broadcasts no true wind on N2K.
        </p>
      </header>

      {err && (
        <div className="text-sm text-rose-400 border border-rose-900 bg-rose-950/40 rounded p-2">
          Could not load wind diagnostics: {err}
        </div>
      )}

      {history !== null && !hasData && !err && (
        <div className="text-sm text-slate-400 border border-slate-800 bg-slate-900 rounded p-2">
          No samples in the last {Math.round(WINDOW_MS / 1000)}s yet — waiting for the bus.
        </div>
      )}

      {rows.map(({ row, series }) => (
        <MultiSourcePlot
          key={row.channel}
          title={row.title}
          unit={row.unit}
          series={series}
          tMin={tMin}
          tMax={tMax}
          valueFmt={fmt1}
        />
      ))}
    </main>
  );
}
