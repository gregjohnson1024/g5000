// Generic multi-line time-series panel. Pure presentational SVG — no hooks/state,
// so no 'use client' directive needed. Each series shares the caller-supplied
// x-domain (tMin..tMax) and the panel auto-fits a single shared y-domain across
// every series' values (padded ~8%). Independent y per panel, shared x across panels.

const WIDTH = 600;
const HEIGHT = 80;
const PAD = { top: 6, right: 8, bottom: 6, left: 8 };

// Stable per-source colour palette. Callers assign by sorting their source set
// and indexing into this array, so a given source keeps the same colour across
// every panel (and across re-renders) even as series come and go.
// Mapped to --series-1..8 tokens; getComputedStyle resolves the live theme value.
export const PLOT_PALETTE: readonly string[] = [
  'var(--series-1)', // #38bdf8 sky-400   in DAY
  'var(--series-2)', // #fbbf24 amber-400 in DAY
  'var(--series-3)', // #34d399 emerald-400 in DAY
  'var(--series-4)', // #f472b6 pink-400  in DAY
  'var(--series-5)', // #a78bfa violet-400 in DAY
  'var(--series-6)', // #fb7185 rose-400  in DAY
  'var(--series-7)', // #4ade80 green-400 in DAY
  'var(--series-8)', // #facc15 yellow-400 in DAY
];

export interface PlotSeries {
  /** Stable identity for React keys — the raw source tag, not the (possibly
   *  duplicated) human label. Two devices can resolve to the same label. */
  id: string;
  label: string;
  color: string;
  points: { tMs: number; v: number }[];
}

export interface MultiSourcePlotProps {
  title: string;
  unit: string;
  series: PlotSeries[];
  tMin: number;
  tMax: number;
  height?: number;
  valueFmt?: (v: number) => string;
}

// Latest sample (by tMs) of a series, or null if empty.
function latest(s: PlotSeries): { tMs: number; v: number } | null {
  let best: { tMs: number; v: number } | null = null;
  for (const p of s.points) {
    if (!best || p.tMs > best.tMs) best = p;
  }
  return best;
}

export function MultiSourcePlot({
  title,
  unit,
  series,
  tMin,
  tMax,
  height = HEIGHT,
  valueFmt = (v) => v.toFixed(1),
}: MultiSourcePlotProps): React.ReactElement {
  const tSpan = Math.max(1, tMax - tMin);

  // Shared y-domain auto-fit across every plottable point, padded ~8%.
  const vals: number[] = [];
  for (const s of series) {
    for (const p of s.points) vals.push(p.v);
  }
  const vMinRaw = vals.length > 0 ? Math.min(...vals) : 0;
  const vMaxRaw = vals.length > 0 ? Math.max(...vals) : 1;
  const vPad = Math.max(1e-6, (vMaxRaw - vMinRaw) * 0.08);
  const vMin = vMinRaw - vPad;
  const vMax = vMaxRaw + vPad;
  const vSpan = Math.max(1e-6, vMax - vMin);

  const plotW = WIDTH - PAD.left - PAD.right;
  const plotH = height - PAD.top - PAD.bottom;
  const yMid = PAD.top + plotH / 2;

  function xOf(tMs: number): number {
    return PAD.left + ((tMs - tMin) / tSpan) * plotW;
  }
  function yOf(v: number): number {
    // Invert: higher value → lower y. Anchor to the shared domain's centre.
    return PAD.top + (1 - (v - vMin) / vSpan) * plotH;
  }

  return (
    <div className="bg-slate-900 border border-slate-800 rounded p-3">
      <div className="text-xs uppercase tracking-wider text-slate-400 mb-2">
        {title} <span className="text-slate-500">({unit})</span>
      </div>
      <svg viewBox={`0 0 ${WIDTH} ${height}`} className="w-full">
        {/* Faint baseline grid */}
        <line
          x1={PAD.left}
          y1={yMid}
          x2={WIDTH - PAD.right}
          y2={yMid}
          stroke="var(--ink-4)"
          strokeDasharray="2 2"
        />
        {series.map((s) => {
          if (s.points.length === 0) return null;
          // A single sample can't form a line — mark it with a dot so a source
          // that is present but sparse stays visible instead of vanishing.
          if (s.points.length === 1) {
            const p = s.points[0]!;
            return (
              <circle
                key={s.id}
                cx={xOf(p.tMs).toFixed(1)}
                cy={yOf(p.v).toFixed(1)}
                r="1.8"
                fill={s.color}
              />
            );
          }
          const pts = s.points
            .map((p) => `${xOf(p.tMs).toFixed(1)},${yOf(p.v).toFixed(1)}`)
            .join(' ');
          return (
            <polyline key={s.id} points={pts} fill="none" stroke={s.color} strokeWidth="1.5" />
          );
        })}
      </svg>
      {/* Legend: swatch + label + latest value */}
      <div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-[10px] font-mono">
        {series.map((s) => {
          const last = latest(s);
          return (
            <span key={s.id} className="inline-flex items-center gap-1 text-slate-400">
              <span
                className="inline-block w-2 h-2 rounded-sm"
                style={{ backgroundColor: s.color }}
              />
              {s.label}
              <span className="text-slate-300">{last ? valueFmt(last.v) : '—'}</span>
            </span>
          );
        })}
      </div>
    </div>
  );
}
