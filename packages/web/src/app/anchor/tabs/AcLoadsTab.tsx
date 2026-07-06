'use client';

// AcLoadsTab — live per-circuit AC load view (Loads tab) plus historical kWh
// (History tab). Polls every 2 s for the Loads view; fetches on demand for History.

import { useEffect, useRef, useState } from 'react';
import type { EmporiaSnapshot, EmporiaCircuit, EmporiaDevice } from '@g5000/core';

const POLL_MS = 2_000;
const FETCH_CAP = 8; // max concurrent history fetches

// ── Emporia config ────────────────────────────────────────────────────────────

type Leg = 'L1' | 'L2' | '240V';

interface EmporiaConfig {
  legAssignments: Record<string, Leg>;
  hiddenChannels: string[];
}

function useEmporiaConfig(): EmporiaConfig {
  const [cfg, setCfg] = useState<EmporiaConfig>({ legAssignments: {}, hiddenChannels: [] });
  useEffect(() => {
    void fetch('/api/settings', { cache: 'no-store' })
      .then((r) => r.json())
      .then((j) => {
        if (j.ok && j.settings?.emporiaConfig) {
          setCfg(j.settings.emporiaConfig as EmporiaConfig);
        }
      })
      .catch(() => {});
  }, []);
  return cfg;
}

// ── Circuit-palette (for stacked bar segments) ────────────────────────────────

const PALETTE = [
  '#38bdf8', // sky-400
  '#34d399', // emerald-400
  '#f97316', // orange-400
  '#a78bfa', // violet-400
  '#fb7185', // rose-400
  '#facc15', // yellow-400
  '#2dd4bf', // teal-400
  '#818cf8', // indigo-400
  '#f472b6', // pink-400
  '#4ade80', // green-400
  '#fbbf24', // amber-400
  '#60a5fa', // blue-400
];

function circuitColor(idx: number): string {
  return PALETTE[idx % PALETTE.length]!;
}

// ── Formatters ────────────────────────────────────────────────────────────────

function fmtW(v: number | null | undefined): string {
  if (v == null || !isFinite(v)) return '—';
  return `${Math.round(v)} W`;
}

function fmtTime(epochMs: number): string {
  try {
    return new Date(epochMs).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  } catch {
    return '—';
  }
}

function fmtKwh(v: number): string {
  if (v < 0.1) return `${(v * 1000).toFixed(0)} Wh`;
  return `${v.toFixed(2)} kWh`;
}

// ── History scale / window helpers ────────────────────────────────────────────

type HistoryScale = 'DAY' | 'WEEK' | 'MONTH';

interface HistoryWindow {
  scale: '1H' | '1D';
  start: string; // ISO
  end: string; // ISO
  bucketMs: number; // ms per bucket (for x-axis labelling)
}

function buildWindow(sel: HistoryScale): HistoryWindow {
  const now = new Date();
  const bucketH = 3_600_000;
  const bucketD = 86_400_000;

  if (sel === 'DAY') {
    const startOfDay = new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
    );
    return {
      scale: '1H',
      start: startOfDay.toISOString(),
      end: now.toISOString(),
      bucketMs: bucketH,
    };
  }

  const daysBack = sel === 'WEEK' ? 7 : 30;
  const startDay = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - daysBack),
  );
  return {
    scale: '1D',
    start: startDay.toISOString(),
    end: now.toISOString(),
    bucketMs: bucketD,
  };
}

// ── Series ────────────────────────────────────────────────────────────────────

interface CircuitSeries {
  channelNum: string;
  name: string;
  color: string;
  // kWh per bucket (null→0 after alignment)
  buckets: number[];
  total: number; // sum of buckets in kWh
}

// ── Aggregate label for the time axis ─────────────────────────────────────────

function bucketLabel(epochMs: number, bucketMs: number): string {
  const d = new Date(epochMs);
  if (bucketMs >= 86_400_000) {
    // Day bucket: show MM/DD
    return `${d.getUTCMonth() + 1}/${d.getUTCDate()}`;
  }
  // Hour bucket: show HH:MM Z at midnight rollover, else HH Z
  const h = d.getUTCHours();
  if (h === 0 && d.getUTCMinutes() === 0) {
    return `${d.getUTCMonth() + 1}/${d.getUTCDate()}`;
  }
  return `${h}Z`;
}

// ── SVG stacked-bar chart ─────────────────────────────────────────────────────

const SVG_W = 680;
const BAR_AREA_H = 160;
const AXIS_H = 22;
const PAD_L = 8;
const PAD_R = 8;
const PLOT_W = SVG_W - PAD_L - PAD_R;
const TOTAL_SVG_H = BAR_AREA_H + AXIS_H;

function StackedBarChart({
  series,
  bucketCount,
  firstEpochMs,
  bucketMs,
}: {
  series: CircuitSeries[];
  bucketCount: number;
  firstEpochMs: number;
  bucketMs: number;
}): React.ReactElement {
  if (bucketCount === 0 || series.length === 0) {
    return <p className="text-slate-500 text-xs italic">No data in range.</p>;
  }

  // Compute per-bucket totals (sum across circuits) for y-scale.
  const bucketTotals = Array.from({ length: bucketCount }, (_, i) =>
    series.reduce((s, c) => s + (c.buckets[i] ?? 0), 0),
  );
  const maxTotal = Math.max(0.0001, ...bucketTotals);

  const barW = Math.max(1, PLOT_W / bucketCount - 0.5);
  const barSpacing = PLOT_W / bucketCount;

  // Axis ticks — show a label every N buckets so they don't crowd.
  const maxLabels = 14;
  const labelEvery = Math.max(1, Math.ceil(bucketCount / maxLabels));

  return (
    <svg
      viewBox={`0 0 ${SVG_W} ${TOTAL_SVG_H}`}
      className="w-full"
      style={{ height: `${TOTAL_SVG_H * 1.1}px` }}
      aria-label="AC energy history stacked bar chart"
    >
      {/* Bars */}
      {Array.from({ length: bucketCount }, (_, bi) => {
        const x = PAD_L + bi * barSpacing;
        let yBase = BAR_AREA_H; // build from bottom up
        const segments: React.ReactElement[] = [];
        for (const c of series) {
          const kwh = c.buckets[bi] ?? 0;
          if (kwh <= 0) continue;
          const h = (kwh / maxTotal) * BAR_AREA_H;
          yBase -= h;
          segments.push(
            <rect
              key={c.channelNum}
              x={x}
              y={yBase}
              width={barW}
              height={h}
              fill={c.color}
              opacity={0.85}
            />,
          );
        }
        return <g key={bi}>{segments}</g>;
      })}

      {/* X-axis line */}
      <line
        x1={PAD_L}
        y1={BAR_AREA_H}
        x2={SVG_W - PAD_R}
        y2={BAR_AREA_H}
        stroke="#334155"
        strokeWidth={1}
      />

      {/* Tick labels */}
      {Array.from({ length: bucketCount }, (_, bi) => {
        if (bi % labelEvery !== 0) return null;
        const epochMs = firstEpochMs + bi * bucketMs;
        const label = bucketLabel(epochMs, bucketMs);
        const x = PAD_L + bi * barSpacing + barW / 2;
        return (
          <text key={bi} x={x} y={BAR_AREA_H + 14} fill="#64748b" fontSize={8} textAnchor="middle">
            {label}
          </text>
        );
      })}

      {/* Y-axis max label */}
      <text x={PAD_L} y={6} fill="#64748b" fontSize={7} dominantBaseline="hanging">
        {fmtKwh(maxTotal)}
      </text>
    </svg>
  );
}

// ── Circuit row ───────────────────────────────────────────────────────────────

function CircuitRow({
  name,
  watts,
  maxW,
}: {
  name: string;
  watts: number | null;
  maxW: number;
}): React.ReactElement {
  const pct =
    watts != null && maxW > 0 ? Math.min(100, Math.round((Math.max(0, watts) / maxW) * 100)) : 0;

  return (
    <div className="flex flex-col gap-0.5">
      <div className="flex items-center justify-between text-xs">
        <span className="text-slate-400 truncate">{name}</span>
        <span className="text-slate-200 tabular-nums font-mono ml-2">{fmtW(watts)}</span>
      </div>
      <div className="h-1.5 rounded-full bg-slate-800 overflow-hidden">
        <div
          className="h-full rounded-full bg-sky-500 transition-all duration-500"
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}

// ── History state ─────────────────────────────────────────────────────────────

type HistoryStatus = 'idle' | 'loading' | 'loaded' | 'error' | 'offline';

interface HistoryState {
  status: HistoryStatus;
  series: CircuitSeries[];
  bucketCount: number;
  firstEpochMs: number;
  bucketMs: number;
  totalKwh: number;
  capped: boolean; // true if some channels were dropped due to FETCH_CAP
}

// ── AcHistoryView ─────────────────────────────────────────────────────────────

function AcHistoryView(): React.ReactElement {
  const [selected, setSelected] = useState<HistoryScale>('DAY');
  const [hist, setHist] = useState<HistoryState>({
    status: 'idle',
    series: [],
    bucketCount: 0,
    firstEpochMs: 0,
    bucketMs: 3_600_000,
    totalKwh: 0,
    capped: false,
  });

  // Use a ref to track the current "generation" of fetch — lets us cancel
  // in-flight fetches when selector changes or on unmount.
  const genRef = useRef(0);

  useEffect(() => {
    const gen = ++genRef.current;

    setHist((prev) => ({ ...prev, status: 'loading', series: [], capped: false }));

    const win = buildWindow(selected);

    async function load(): Promise<void> {
      // 1. Fetch device list.
      let devices: EmporiaDevice[];
      try {
        const r = await fetch('/api/emporia/devices', { cache: 'no-store' });
        if (gen !== genRef.current) return;
        if (!r.ok) {
          setHist((prev) => ({ ...prev, status: 'error' }));
          return;
        }
        const j = (await r.json()) as { devices: EmporiaDevice[] };
        if (gen !== genRef.current) return;
        devices = j.devices;
      } catch {
        if (gen !== genRef.current) return;
        setHist((prev) => ({ ...prev, status: 'error' }));
        return;
      }

      if (devices.length === 0) {
        if (gen !== genRef.current) return;
        setHist((prev) => ({ ...prev, status: 'offline' }));
        return;
      }

      // 2. Collect visible channels from all devices, excluding aggregates.
      // We skip "1,2,3" (mains) and "Balance" channels.
      const SKIP_NAMES = /^balance$/i;
      const SKIP_CHANNEL_NUMS = new Set(['1,2,3']);

      interface ChannelRef {
        gid: number;
        channelNum: string;
        name: string;
        multiplier: number;
      }

      const channels: ChannelRef[] = [];
      for (const dev of devices) {
        for (const ch of dev.channels) {
          if (SKIP_CHANNEL_NUMS.has(ch.channelNum)) continue;
          if (SKIP_NAMES.test(ch.name)) continue;
          channels.push({
            gid: dev.deviceGid,
            channelNum: ch.channelNum,
            name: ch.name,
            multiplier: ch.multiplier,
          });
        }
      }

      let capped = false;
      let fetchList = channels;
      if (fetchList.length > FETCH_CAP) {
        capped = true;
        console.warn(
          `[AcHistoryView] ${fetchList.length} channels exceed cap of ${FETCH_CAP}; ` +
            `fetching only the first ${FETCH_CAP}.`,
        );
        fetchList = fetchList.slice(0, FETCH_CAP);
      }

      if (fetchList.length === 0) {
        if (gen !== genRef.current) return;
        setHist((prev) => ({ ...prev, status: 'offline' }));
        return;
      }

      // 3. Fetch history for each channel concurrently (capped to ≤ FETCH_CAP).
      type RawResult = {
        channelNum: string;
        name: string;
        multiplier: number;
        firstUsageInstant: string;
        usageList: Array<number | null>;
      };

      const results = await Promise.all(
        fetchList.map(async (ch): Promise<RawResult | null> => {
          try {
            const url =
              `/api/emporia/history?gid=${ch.gid}` +
              `&channel=${encodeURIComponent(ch.channelNum)}` +
              `&scale=${win.scale}` +
              `&start=${encodeURIComponent(win.start)}` +
              `&end=${encodeURIComponent(win.end)}`;
            const r = await fetch(url, { cache: 'no-store' });
            if (gen !== genRef.current) return null;
            if (!r.ok) return null;
            const j = (await r.json()) as
              | { firstUsageInstant: string; usageList: Array<number | null> }
              | { offline: boolean }
              | { error: string };
            if ('offline' in j || 'error' in j) return null;
            return {
              channelNum: ch.channelNum,
              name: ch.name,
              multiplier: ch.multiplier,
              firstUsageInstant: j.firstUsageInstant,
              usageList: j.usageList,
            };
          } catch {
            return null;
          }
        }),
      );

      if (gen !== genRef.current) return;

      const good = results.filter((r): r is RawResult => r !== null);
      if (good.length === 0) {
        setHist((prev) => ({ ...prev, status: 'error' }));
        return;
      }

      // 4. Align series by firstUsageInstant.
      // Find the earliest firstUsageInstant and compute the shared origin epoch.
      // All buckets are assumed to share the same bucket grid (same start+scale).
      const firstEpochMs = Math.min(...good.map((r) => new Date(r.firstUsageInstant).getTime()));
      const bucketMs = win.bucketMs;

      // Each series is offset by how many buckets its own firstUsageInstant is
      // ahead of the global firstEpochMs. We pad the front with zeros.
      const bucketCount = Math.max(
        ...good.map((r) => {
          const offset = Math.round(
            (new Date(r.firstUsageInstant).getTime() - firstEpochMs) / bucketMs,
          );
          return offset + r.usageList.length;
        }),
      );

      const seriesArr: CircuitSeries[] = good.map((r, idx) => {
        const offset = Math.round(
          (new Date(r.firstUsageInstant).getTime() - firstEpochMs) / bucketMs,
        );
        const aligned = Array<number>(bucketCount).fill(0);
        for (let i = 0; i < r.usageList.length; i++) {
          const raw = r.usageList[i] ?? 0;
          // Apply multiplier (240V paired circuits) — values are already kWh.
          aligned[offset + i] = Math.max(0, raw * r.multiplier);
        }
        const total = aligned.reduce((s, v) => s + v, 0);
        return {
          channelNum: r.channelNum,
          name: r.name,
          color: circuitColor(idx),
          buckets: aligned,
          total,
        };
      });

      // Sort series by total desc (top consumers first in the legend + bars).
      seriesArr.sort((a, b) => b.total - a.total);

      const totalKwh = seriesArr.reduce((s, c) => s + c.total, 0);

      setHist({
        status: 'loaded',
        series: seriesArr,
        bucketCount,
        firstEpochMs,
        bucketMs,
        totalKwh,
        capped,
      });
    }

    void load();

    // Cleanup: bump gen so any in-flight fetch callbacks are silently dropped.
    return () => {
      genRef.current++;
    };
  }, [selected]);

  const scales: HistoryScale[] = ['DAY', 'WEEK', 'MONTH'];

  return (
    <div className="flex flex-col gap-3">
      {/* Selector */}
      <div className="flex gap-1">
        {scales.map((s) => (
          <button
            key={s}
            onClick={() => setSelected(s)}
            className={`px-2 py-0.5 text-[10px] rounded font-mono uppercase tracking-wide transition-colors ${
              selected === s
                ? 'bg-sky-700 text-sky-100'
                : 'bg-slate-800 text-slate-400 hover:bg-slate-700'
            }`}
          >
            {s}
          </button>
        ))}
      </div>

      {/* States */}
      {hist.status === 'loading' && (
        <p className="text-slate-500 text-xs italic">Loading history…</p>
      )}
      {(hist.status === 'error' || hist.status === 'offline') && (
        <p className="text-slate-500 text-xs italic">AC history unavailable / offline.</p>
      )}

      {hist.status === 'loaded' && hist.series.length > 0 && (
        <>
          {/* Total */}
          <div className="flex items-baseline gap-2">
            <span className="text-xl font-semibold font-mono text-sky-300 tabular-nums">
              {fmtKwh(hist.totalKwh)}
            </span>
            <span className="text-xs text-slate-400">total — {selected.toLowerCase()}</span>
          </div>

          {hist.capped && (
            <p className="text-[10px] text-amber-500/80 italic">
              Showing top {FETCH_CAP} circuits (channel count exceeded fetch cap).
            </p>
          )}

          {/* Stacked bar chart */}
          <div className="overflow-x-auto">
            <p className="text-[10px] text-slate-600 mb-1 uppercase tracking-wide">
              kWh per bucket — UTC
            </p>
            <StackedBarChart
              series={hist.series}
              bucketCount={hist.bucketCount}
              firstEpochMs={hist.firstEpochMs}
              bucketMs={hist.bucketMs}
            />
          </div>

          {/* Top consumers legend */}
          <div className="flex flex-col gap-1">
            <p className="text-[10px] text-slate-600 uppercase tracking-wide">Top consumers</p>
            {hist.series.map((c) => {
              const pct = hist.totalKwh > 0 ? Math.round((c.total / hist.totalKwh) * 100) : 0;
              return (
                <div key={c.channelNum} className="flex items-center gap-2 text-xs">
                  <span
                    className="inline-block w-2.5 h-2.5 rounded-sm flex-shrink-0"
                    style={{ backgroundColor: c.color }}
                  />
                  <span className="text-slate-400 truncate flex-1">{c.name}</span>
                  <span className="text-slate-200 font-mono tabular-nums ml-auto whitespace-nowrap">
                    {fmtKwh(c.total)}
                  </span>
                  <span className="text-slate-500 font-mono tabular-nums w-8 text-right">
                    {pct}%
                  </span>
                </div>
              );
            })}
          </div>
        </>
      )}

      {hist.status === 'loaded' && hist.series.length === 0 && (
        <p className="text-slate-500 text-xs italic">No circuit data in range.</p>
      )}
    </div>
  );
}

// ── Main tab ──────────────────────────────────────────────────────────────────

type SubView = 'loads' | 'history';

export function AcLoadsTab(): React.ReactElement {
  const [view, setView] = useState<SubView>('loads');
  const [snapshot, setSnapshot] = useState<(EmporiaSnapshot & { offline?: boolean }) | null>(null);
  const [lastKnownAt, setLastKnownAt] = useState<number | null>(null);
  const [offline, setOffline] = useState(false);
  const emporiaConfig = useEmporiaConfig();

  useEffect(() => {
    let cancelled = false;

    const poll = async (): Promise<void> => {
      try {
        const r = await fetch('/api/emporia/state', { cache: 'no-store' });
        if (cancelled) return;
        if (!r.ok) return;
        const j = (await r.json()) as EmporiaSnapshot & { offline?: boolean };
        if (cancelled) return;
        if (!j.connected || j.offline) {
          setOffline(true);
          if (j.updatedAt && j.updatedAt > 0) setLastKnownAt(j.updatedAt);
        } else {
          setOffline(false);
          setLastKnownAt(j.updatedAt);
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

  // ── Sub-view toggle ─────────────────────────────────────────────────────────

  const views: { id: SubView; label: string }[] = [
    { id: 'loads', label: 'Loads' },
    { id: 'history', label: 'History' },
  ];

  const toggle = (
    <div className="flex gap-0.5 mb-2">
      {views.map((v) => (
        <button
          key={v.id}
          onClick={() => setView(v.id)}
          className={`px-2 py-0.5 text-[10px] rounded font-mono uppercase tracking-wide transition-colors ${
            view === v.id
              ? 'bg-slate-700 text-slate-100'
              : 'bg-slate-900 text-slate-500 hover:bg-slate-800'
          }`}
        >
          {v.label}
        </button>
      ))}
    </div>
  );

  // ── History sub-view ────────────────────────────────────────────────────────

  if (view === 'history') {
    return (
      <div className="flex flex-col gap-1">
        {toggle}
        <AcHistoryView />
      </div>
    );
  }

  // ── Loads sub-view (original content) ──────────────────────────────────────

  if (offline || snapshot === null) {
    return (
      <div className="flex flex-col gap-1">
        {toggle}
        <p className="text-slate-500 text-xs italic">Emporia not configured / offline</p>
        {lastKnownAt != null && lastKnownAt > 0 && (
          <p className="text-slate-600 text-[10px]">Last known: {fmtTime(lastKnownAt)}</p>
        )}
      </div>
    );
  }

  // Apply hidden filter and sort circuits by watts desc (nulls last).
  const hiddenSet = new Set(emporiaConfig.hiddenChannels);
  const visible: EmporiaCircuit[] = snapshot.circuits
    .filter((c) => !hiddenSet.has(c.channelNum))
    .sort((a, b) => {
      if (a.watts == null && b.watts == null) return 0;
      if (a.watts == null) return 1;
      if (b.watts == null) return -1;
      return b.watts - a.watts;
    });

  const { legAssignments } = emporiaConfig;
  const hasLegAssignments = Object.keys(legAssignments).length > 0;

  // Max watts across visible circuits (used for bar scaling; exclude balance/mains here).
  const circuitWatts = visible.map((c) => c.watts ?? 0);
  const maxCircuitW = Math.max(0, ...circuitWatts);

  // Also include balanceW in max for consistent bar scale.
  const maxW = Math.max(maxCircuitW, snapshot.balanceW ?? 0);

  // Build leg groups and summary when leg assignments exist.
  const LEG_ORDER: Leg[] = ['L1', 'L2', '240V'];

  const legSum = (leg: Leg): number =>
    visible
      .filter((c) => legAssignments[c.channelNum] === leg)
      .reduce((s, c) => s + (c.watts ?? 0), 0);

  const circuitsByLeg = (leg: Leg): EmporiaCircuit[] =>
    visible.filter((c) => legAssignments[c.channelNum] === leg);

  const unassigned: EmporiaCircuit[] = visible.filter((c) => !legAssignments[c.channelNum]);

  return (
    <div className="flex flex-col gap-3">
      {toggle}

      {/* Total mains header */}
      <div className="flex items-baseline gap-2">
        <span className="text-2xl font-semibold font-mono text-sky-300 tabular-nums">
          {snapshot.mainsW != null ? Math.round(snapshot.mainsW) : '—'}
        </span>
        <span className="text-xs text-slate-400">W total AC</span>
      </div>

      {/* L1 / L2 / 240V summary cards (only when leg assignments exist) */}
      {hasLegAssignments && (
        <div className="flex gap-2">
          {LEG_ORDER.map((leg) => (
            <div
              key={leg}
              className="flex-1 flex flex-col items-center bg-slate-800 rounded p-2 gap-0.5"
            >
              <span className="text-[10px] text-slate-500 uppercase tracking-wide">{leg}</span>
              <span className="text-sm font-mono font-semibold text-sky-300 tabular-nums">
                {fmtW(legSum(leg))}
              </span>
            </div>
          ))}
        </div>
      )}

      {/* Per-circuit rows */}
      {visible.length === 0 && (snapshot.balanceW == null || snapshot.balanceW === 0) ? (
        <p className="text-slate-600 text-xs italic">No circuits reported</p>
      ) : hasLegAssignments ? (
        // Grouped by leg
        <div className="flex flex-col gap-3">
          {LEG_ORDER.map((leg) => {
            const rows = circuitsByLeg(leg);
            if (rows.length === 0) return null;
            return (
              <div key={leg} className="flex flex-col gap-1">
                <p className="text-[10px] text-slate-500 uppercase tracking-wide">{leg}</p>
                <div className="flex flex-col gap-2">
                  {rows.map((c) => (
                    <CircuitRow key={c.channelNum} name={c.name} watts={c.watts} maxW={maxW} />
                  ))}
                </div>
              </div>
            );
          })}

          {/* Unassigned */}
          {unassigned.length > 0 && (
            <div className="flex flex-col gap-1">
              <p className="text-[10px] text-slate-500 uppercase tracking-wide">Unassigned</p>
              <div className="flex flex-col gap-2">
                {unassigned.map((c) => (
                  <CircuitRow key={c.channelNum} name={c.name} watts={c.watts} maxW={maxW} />
                ))}
              </div>
            </div>
          )}

          {/* Balance row — "Everything else" */}
          {snapshot.balanceW != null && (
            <CircuitRow name="Everything else" watts={snapshot.balanceW} maxW={maxW} />
          )}
        </div>
      ) : (
        // Flat sorted list (default — unchanged behavior)
        <div className="flex flex-col gap-2">
          {visible.map((c) => (
            <CircuitRow key={c.channelNum} name={c.name} watts={c.watts} maxW={maxW} />
          ))}

          {/* Balance row — "Everything else" */}
          {snapshot.balanceW != null && (
            <CircuitRow name="Everything else" watts={snapshot.balanceW} maxW={maxW} />
          )}
        </div>
      )}
    </div>
  );
}
