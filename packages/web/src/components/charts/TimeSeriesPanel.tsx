/**
 * TimeSeriesPanel — Tier-2 chart primitive.
 *
 * Chassis derived from MultiSourcePlot. Improvements:
 *   - Responsive viewBox: fills container width (no hardcoded 600px).
 *   - Real 3 y-ticks (min / mid / max) drawn as dashed grid lines + labels.
 *   - Optional fixed `domain` prop — kills the ±0.1°-renders-as-drama bug.
 *   - Token-only styling (no raw hex, no slate-* classes).
 *   - Minimum 12px SVG text (overhaul floor).
 *   - Mono legend with live values, derived from series colours.
 *   - Optional `nowMs` draws a vertical `--now-line` at that timestamp.
 *
 * Pure presentational — no hooks, no 'use client' needed.
 */

import { computeYDomain, xCoord, yCoord, yTicks, fmtTick } from './plot-scale';

// Re-export for callers who build their PlotSeries from this module.
export type { PlotSeries } from '../MultiSourcePlot';
export { PLOT_PALETTE } from '../MultiSourcePlot';

export interface TimeSeriesPanelProps {
  /** Panel header label */
  title: string;
  /** Unit string shown in parens after the title */
  unit: string;
  /** Data series; each series has its own colour from PLOT_PALETTE */
  series: {
    id: string;
    label: string;
    color: string;
    points: { tMs: number; v: number }[];
  }[];
  /** X-domain: start timestamp (ms) */
  tMin: number;
  /** X-domain: end timestamp (ms) */
  tMax: number;
  /**
   * Fixed y-domain [min, max]. When provided, the chart renders within this
   * range regardless of data values — a series that lives in [-0.1, 0.1] with
   * domain=[-5, 5] renders as a nearly-flat line rather than a full-height spike.
   */
  domain?: [number, number];
  /** SVG height in px (default 80). Width is always 100% of container. */
  height?: number;
  /**
   * Formatter for legend values and y-axis tick labels.
   * Defaults to one decimal place.
   */
  valueFmt?: (v: number) => string;
  /**
   * Optional timestamp (ms) at which to draw a vertical "now" line.
   * Drawn in var(--now-line).
   */
  nowMs?: number;
  /** Additional className for the outer wrapper div. */
  className?: string;
}

const VIEWBOX_W = 480; // logical SVG width (responsive: fills container via 100% CSS width)
const DEFAULT_HEIGHT = 80;

// Padding inside the plot area. Left is wider to accommodate y-tick labels.
const PAD = { top: 12, right: 8, bottom: 6, left: 36 };

/** Latest sample (max tMs) or null if series is empty. */
function latestSample(points: { tMs: number; v: number }[]): { tMs: number; v: number } | null {
  let best: { tMs: number; v: number } | null = null;
  for (const p of points) {
    if (!best || p.tMs > best.tMs) best = p;
  }
  return best;
}

export function TimeSeriesPanel({
  title,
  unit,
  series,
  tMin,
  tMax,
  domain,
  height = DEFAULT_HEIGHT,
  valueFmt = (v) => v.toFixed(1),
  nowMs,
  className = '',
}: TimeSeriesPanelProps): React.ReactElement {
  // Collect all values for auto-fit (bypassed when domain is fixed).
  const allValues: number[] = [];
  for (const s of series) {
    for (const p of s.points) allValues.push(p.v);
  }
  const yDomain = computeYDomain(allValues, domain);
  const ticks = yTicks(yDomain);

  const plotW = VIEWBOX_W - PAD.left - PAD.right;
  const plotH = height - PAD.top - PAD.bottom;

  const x = (tMs: number) => xCoord(tMs, tMin, tMax, PAD.left, plotW);
  const y = (v: number) => yCoord(v, yDomain, PAD.top, plotH);

  return (
    <div className={`bg-surface border border-hairline rounded-[--r-panel] p-3 ${className}`}>
      {/* Header */}
      <div className="text-label uppercase tracking-wider text-ink-2 mb-2">
        {title} <span className="text-ink-3 normal-case">({unit})</span>
      </div>

      {/* Chart */}
      <svg
        viewBox={`0 0 ${VIEWBOX_W} ${height}`}
        className="w-full"
        style={{ height: `${height}px` }}
        aria-hidden="true"
      >
        {/* Y-axis grid lines + tick labels — exactly 3 */}
        {ticks.map((tv, i) => {
          const yv = y(tv);
          return (
            <g key={i}>
              <line
                x1={PAD.left}
                y1={yv}
                x2={VIEWBOX_W - PAD.right}
                y2={yv}
                stroke="var(--hairline-strong)"
                strokeDasharray="2 3"
                strokeWidth="0.5"
              />
              <text
                x={PAD.left - 4}
                y={yv}
                textAnchor="end"
                dominantBaseline="middle"
                fontSize="12"
                fontFamily="monospace"
                fill="var(--ink-3)"
              >
                {fmtTick(tv)}
              </text>
            </g>
          );
        })}

        {/* Now-line */}
        {nowMs !== undefined && nowMs >= tMin && nowMs <= tMax && (
          <line
            x1={x(nowMs)}
            y1={PAD.top}
            x2={x(nowMs)}
            y2={PAD.top + plotH}
            stroke="var(--now-line)"
            strokeWidth="1"
          />
        )}

        {/* Series polylines */}
        {series.map((s) => {
          if (s.points.length === 0) return null;
          if (s.points.length === 1) {
            const p = s.points[0]!;
            return (
              <circle
                key={s.id}
                cx={x(p.tMs).toFixed(2)}
                cy={y(p.v).toFixed(2)}
                r="2"
                fill={s.color}
              />
            );
          }
          const pts = s.points.map((p) => `${x(p.tMs).toFixed(2)},${y(p.v).toFixed(2)}`).join(' ');
          return (
            <polyline
              key={s.id}
              points={pts}
              fill="none"
              stroke={s.color}
              strokeWidth="1.5"
              strokeLinejoin="round"
            />
          );
        })}
      </svg>

      {/* Legend */}
      <div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 font-mono text-caption">
        {series.map((s) => {
          const last = latestSample(s.points);
          return (
            <span key={s.id} className="inline-flex items-center gap-1 text-ink-2">
              <span
                className="inline-block w-2 h-2 rounded-sm flex-shrink-0"
                style={{ backgroundColor: s.color }}
                aria-hidden="true"
              />
              <span>{s.label}</span>
              <span className="text-ink tabular-nums">{last ? valueFmt(last.v) : '—'}</span>
            </span>
          );
        })}
      </div>
    </div>
  );
}
