/**
 * StripChart — Tier-2 chart primitive.
 *
 * One component for all conditions strip charts (heals the tide/current drifted
 * twins). Draws a curve with:
 *   - Optional "now" vertical line (--now-line, NOT --flow-ebb)
 *   - Optional event markers with --flow-flood / --flow-ebb / --flow-slack dots
 *   - Source badge (top-right)
 *   - Pin button (keeps or removes the strip from a multi-strip view)
 *   - Tap-scrub: touch/click on the SVG emits the interpolated value at that x
 *
 * Token-only. UTC-only time labels. No raw hex.
 * Pure presentational except for the tap-scrub interaction.
 */

'use client';

import { useCallback, useRef } from 'react';

export type EventKind = 'flood' | 'ebb' | 'slack';

export interface StripEvent {
  tMs: number;
  kind: EventKind;
  label?: string;
}

export interface StripPoint {
  tMs: number;
  v: number;
}

export interface StripChartProps {
  /** Panel label */
  label: string;
  /** Data points */
  points: StripPoint[];
  /** X-domain start (ms) */
  tMin: number;
  /** X-domain end (ms) */
  tMax: number;
  /** Fixed y-domain [min, max]. If omitted, auto-fit with 10% padding. */
  domain?: [number, number];
  /** Curve stroke colour. Defaults to var(--series-1). */
  color?: string;
  /** Event markers (e.g. tide highs, lows, slacks) */
  events?: StripEvent[];
  /** Current time (ms). If provided, draws the now-line. */
  nowMs?: number;
  /** Source label for the badge (e.g. "NOAA Tides", "CMEMS") */
  source?: string;
  /** Whether this strip is pinned. If undefined, no pin button shown. */
  pinned?: boolean;
  onPinToggle?: () => void;
  /** Called when user taps/clicks the chart at a given timestamp */
  onScrub?: (tMs: number, interpolatedValue: number | null) => void;
  height?: number;
  className?: string;
}

const VIEWBOX_W = 480;
const DEFAULT_HEIGHT = 72;
const PAD = { top: 8, right: 8, bottom: 16, left: 8 };

const EVENT_COLOR: Record<EventKind, string> = {
  flood: 'var(--flow-flood)',
  ebb: 'var(--flow-ebb)',
  slack: 'var(--flow-slack)',
};

function autoFitDomain(points: StripPoint[]): [number, number] {
  if (points.length === 0) return [0, 1];
  const vals = points.map((p) => p.v);
  const lo = Math.min(...vals);
  const hi = Math.max(...vals);
  const span = Math.max(1e-6, hi - lo);
  return [lo - span * 0.1, hi + span * 0.1];
}

function lerp(points: StripPoint[], tMs: number): number | null {
  if (points.length === 0) return null;
  for (let i = 0; i < points.length - 1; i++) {
    const a = points[i]!;
    const b = points[i + 1]!;
    if (tMs >= a.tMs && tMs <= b.tMs) {
      const t = (tMs - a.tMs) / Math.max(1, b.tMs - a.tMs);
      return a.v + (b.v - a.v) * t;
    }
  }
  return null;
}

function fmtTimeUtc(tMs: number): string {
  return new Date(tMs).toISOString().slice(11, 16) + 'z';
}

export function StripChart({
  label,
  points,
  tMin,
  tMax,
  domain,
  color = 'var(--series-1)',
  events = [],
  nowMs,
  source,
  pinned,
  onPinToggle,
  onScrub,
  height = DEFAULT_HEIGHT,
  className = '',
}: StripChartProps): React.ReactElement {
  const svgRef = useRef<SVGSVGElement>(null);

  const [dMin, dMax] = domain ?? autoFitDomain(points);
  const tSpan = Math.max(1, tMax - tMin);
  const vSpan = Math.max(1e-6, dMax - dMin);
  const plotW = VIEWBOX_W - PAD.left - PAD.right;
  const plotH = height - PAD.top - PAD.bottom;

  const xOf = (tMs: number) => PAD.left + ((tMs - tMin) / tSpan) * plotW;
  const yOf = (v: number) => PAD.top + (1 - (v - dMin) / vSpan) * plotH;

  // Build SVG polyline path string
  const polyPts =
    points.length > 0
      ? points.map((p) => `${xOf(p.tMs).toFixed(2)},${yOf(p.v).toFixed(2)}`).join(' ')
      : '';

  // Scrub handler: map click/touch x position to timestamp then interpolate
  const handleSvgClick = useCallback(
    (e: React.MouseEvent<SVGSVGElement>) => {
      if (!onScrub || !svgRef.current) return;
      const rect = svgRef.current.getBoundingClientRect();
      const relX = e.clientX - rect.left;
      const fraction = (relX - PAD.left) / Math.max(1, rect.width - PAD.left - PAD.right);
      const tMs = tMin + fraction * tSpan;
      onScrub(tMs, lerp(points, tMs));
    },
    [onScrub, tMin, tSpan, points],
  );

  const isEmpty = points.length === 0;

  return (
    <div className={`bg-surface border border-hairline rounded-[--r-panel] p-3 ${className}`}>
      {/* Header row */}
      <div className="flex items-center justify-between mb-1.5">
        <span className="text-label uppercase tracking-wider text-ink-2">{label}</span>
        <div className="flex items-center gap-2">
          {source && (
            <span className="text-caption text-ink-3 bg-surface-raised px-1.5 py-0.5 rounded-[--r-badge]">
              {source}
            </span>
          )}
          {pinned !== undefined && onPinToggle && (
            <button
              type="button"
              onClick={onPinToggle}
              aria-label={pinned ? 'Unpin strip' : 'Pin strip'}
              aria-pressed={pinned}
              className="text-caption text-ink-3 hover:text-ink transition-colors px-1.5 py-0.5 rounded-[--r-control] border border-hairline hover:border-hairline-strong"
            >
              {pinned ? 'pinned' : 'pin'}
            </button>
          )}
        </div>
      </div>

      {/* SVG strip */}
      {isEmpty ? (
        <div
          className="flex items-center justify-center text-ink-4 font-mono"
          style={{ height: `${height}px` }}
        >
          —
        </div>
      ) : (
        <svg
          ref={svgRef}
          viewBox={`0 0 ${VIEWBOX_W} ${height}`}
          className={`w-full ${onScrub ? 'cursor-crosshair' : ''}`}
          style={{ height: `${height}px` }}
          onClick={onScrub ? handleSvgClick : undefined}
          aria-hidden="true"
        >
          {/* Zero line (for signed data) */}
          {dMin < 0 && dMax > 0 && (
            <line
              x1={PAD.left}
              y1={yOf(0)}
              x2={VIEWBOX_W - PAD.right}
              y2={yOf(0)}
              stroke="var(--hairline-strong)"
              strokeDasharray="2 3"
              strokeWidth="0.5"
            />
          )}

          {/* Curve */}
          <polyline
            points={polyPts}
            fill="none"
            stroke={color}
            strokeWidth="1.5"
            strokeLinejoin="round"
          />

          {/* Event markers */}
          {events.map((ev, i) => {
            const ex = xOf(ev.tMs);
            if (ex < PAD.left || ex > PAD.left + plotW) return null;
            return (
              <g key={i}>
                <line
                  x1={ex}
                  y1={PAD.top}
                  x2={ex}
                  y2={PAD.top + plotH}
                  stroke={EVENT_COLOR[ev.kind]}
                  strokeWidth="0.75"
                  strokeDasharray="1 2"
                />
                <circle cx={ex} cy={PAD.top + plotH * 0.15} r="3" fill={EVENT_COLOR[ev.kind]} />
                {ev.label && (
                  <text
                    x={ex + 3}
                    y={PAD.top + plotH * 0.15 + 4}
                    fontSize="10"
                    fontFamily="monospace"
                    fill={EVENT_COLOR[ev.kind]}
                  >
                    {ev.label}
                  </text>
                )}
              </g>
            );
          })}

          {/* Now-line */}
          {nowMs !== undefined && nowMs >= tMin && nowMs <= tMax && (
            <line
              x1={xOf(nowMs)}
              y1={PAD.top}
              x2={xOf(nowMs)}
              y2={PAD.top + plotH}
              stroke="var(--now-line)"
              strokeWidth="1"
            />
          )}

          {/* X-axis time ticks: start, mid, end */}
          {[tMin, (tMin + tMax) / 2, tMax].map((t, i) => (
            <text
              key={i}
              x={xOf(t)}
              y={height - 2}
              textAnchor={i === 0 ? 'start' : i === 2 ? 'end' : 'middle'}
              fontSize="10"
              fontFamily="monospace"
              fill="var(--ink-3)"
            >
              {fmtTimeUtc(t)}
            </text>
          ))}
        </svg>
      )}
    </div>
  );
}
