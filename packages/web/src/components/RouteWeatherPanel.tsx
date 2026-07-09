'use client';
import { useMemo, useRef, useState } from 'react';
import type { Route } from '@g5000/routing';
import { buildRouteWeatherSeries } from '../lib/route-weather';
import { fmtShortTime } from '../lib/tz';
import { useShipClock } from '../lib/use-ship-clock';
import { MS_TO_KN } from '../lib/units';

const MODELS = ['GFS', 'ECMWF'] as const;
type Model = (typeof MODELS)[number];
const COLOR: Record<Model, string> = { GFS: 'var(--accent-hi)', ECMWF: 'var(--route-alt)' };
const SOG_COLOR = 'var(--ink-2)';

// SVG viewBox geometry. Rendered at width:100% so it fills the sidebar.
const W = 300;
const H = 120;
const M = { left: 26, right: 6, top: 16, bottom: 16 };
const PLOT_W = W - M.left - M.right;
const PLOT_H = H - M.top - M.bottom;

/** Candidate x-tick intervals (seconds); pick the smallest giving ≤ 6 ticks. */
const TICK_STEPS = [3600, 3 * 3600, 6 * 3600, 12 * 3600, 24 * 3600, 48 * 3600];

/** Weather-along-route card: TWS/SOG vs time from the planned route's own
 *  legs (no fetches), with motoring stretches shaded and a cursor synced to
 *  the shared playback clock. Click/drag on the chart scrubs playback. */
export function RouteWeatherPanel(props: {
  routes: Partial<Record<Model, Route>>;
  /** Shared playback time (unix s), or null before the scrubber initialises. */
  t: number | null;
  onTChange: (t: number) => void;
}) {
  const available = MODELS.filter((m) => props.routes[m]);
  const [tab, setTab] = useState<Model>('GFS');
  const model = props.routes[tab] ? tab : available[0];
  const route = model ? props.routes[model] : undefined;
  const svgRef = useRef<SVGSVGElement | null>(null);
  const clock = useShipClock();

  const series = useMemo(() => (route ? buildRouteWeatherSeries(route) : null), [route]);

  if (!model || !route || !series || series.points.length < 2) return null;

  const { points, summary } = series;
  const t0 = route.start;
  const t1 = route.end;
  const xOf = (t: number): number => M.left + ((t - t0) / (t1 - t0)) * PLOT_W;
  const tOf = (x: number): number => t0 + ((x - M.left) / PLOT_W) * (t1 - t0);
  const yMaxKn = Math.max(5, Math.ceil(Math.max(...points.map((p) => p.tws * MS_TO_KN)) / 5) * 5);
  const yOf = (kn: number): number => M.top + PLOT_H - (Math.min(kn, yMaxKn) / yMaxKn) * PLOT_H;

  const linePath = (get: (p: (typeof points)[number]) => number): string =>
    points
      .map((p, i) => `${i === 0 ? 'M' : 'L'}${xOf(p.t).toFixed(1)},${yOf(get(p)).toFixed(1)}`)
      .join(' ');

  // Contiguous motoring stretches → shaded rects. Each run extends from its
  // first motoring sample to the following sample (or the route end).
  const motorRuns: Array<{ a: number; b: number }> = [];
  for (let i = 0; i < points.length; i++) {
    if (!points[i]!.motoring) continue;
    const a = points[i]!.t;
    let j = i;
    while (j + 1 < points.length && points[j + 1]!.motoring) j++;
    motorRuns.push({ a, b: j + 1 < points.length ? points[j + 1]!.t : t1 });
    i = j;
  }

  // Sparse wind arrows along the top: at most ~8, pointing downwind.
  const arrowStride = Math.max(1, Math.ceil(points.length / 8));
  const arrows = points.filter((_, i) => i % arrowStride === 0 && i > 0 && i < points.length - 1);

  const tickStep = TICK_STEPS.find((s) => (t1 - t0) / s <= 6) ?? TICK_STEPS[TICK_STEPS.length - 1]!;
  const ticks: number[] = [];
  for (let t = Math.ceil(t0 / tickStep) * tickStep; t <= t1; t += tickStep) ticks.push(t);

  const cursorT = props.t == null ? null : Math.min(Math.max(props.t, t0), t1);

  const scrubTo = (e: React.PointerEvent<SVGSVGElement>): void => {
    const svg = svgRef.current;
    if (!svg) return;
    const rect = svg.getBoundingClientRect();
    const x = ((e.clientX - rect.left) / rect.width) * W;
    props.onTChange(Math.min(Math.max(tOf(x), t0), t1));
  };

  return (
    <section className="space-y-2 bg-slate-900/60 border border-slate-800 rounded p-2">
      <div className="flex items-center gap-2">
        <h3 className="text-sm font-semibold">Route weather</h3>
        {available.length > 1 && (
          <div className="flex gap-1 ml-auto">
            {available.map((m) => (
              <button
                key={m}
                onClick={() => setTab(m)}
                className={`px-2 py-0.5 text-xs rounded border ${
                  m === model ? 'border-slate-500 bg-slate-700' : 'border-slate-700 text-slate-400'
                }`}
                style={m === model ? { color: COLOR[m] } : undefined}
              >
                {m}
              </button>
            ))}
          </div>
        )}
      </div>
      <svg
        ref={svgRef}
        viewBox={`0 0 ${W} ${H}`}
        className="w-full cursor-crosshair select-none touch-none"
        onPointerDown={(e) => {
          e.currentTarget.setPointerCapture(e.pointerId);
          scrubTo(e);
        }}
        onPointerMove={(e) => {
          if (e.currentTarget.hasPointerCapture(e.pointerId)) scrubTo(e);
        }}
      >
        {/* Motoring stretches */}
        {motorRuns.map((r, i) => (
          <rect
            key={i}
            x={xOf(r.a)}
            y={M.top}
            width={Math.max(xOf(r.b) - xOf(r.a), 1)}
            height={PLOT_H}
            fill="var(--ink-3)"
            opacity={0.22}
          />
        ))}
        {/* Y axis (TWS/SOG, kn) */}
        {[0, yMaxKn / 2, yMaxKn].map((kn) => (
          <g key={kn}>
            <line
              x1={M.left}
              x2={W - M.right}
              y1={yOf(kn)}
              y2={yOf(kn)}
              stroke="var(--hairline-strong)"
              strokeWidth={0.5}
            />
            <text
              x={M.left - 3}
              y={yOf(kn) + 2.5}
              fontSize={7}
              fill="var(--ink-2)"
              textAnchor="end"
            >
              {kn}
            </text>
          </g>
        ))}
        {/* X ticks (ship clock) */}
        {ticks.map((t) => (
          <g key={t}>
            <line
              x1={xOf(t)}
              x2={xOf(t)}
              y1={M.top + PLOT_H}
              y2={M.top + PLOT_H + 3}
              stroke="var(--ink-3)"
              strokeWidth={0.5}
            />
            <text x={xOf(t)} y={H - 4} fontSize={7} fill="var(--ink-2)" textAnchor="middle">
              {fmtShortTime(t, clock)}
            </text>
          </g>
        ))}
        {/* Wind-direction arrows (downwind-pointing), from tack-signed TWA */}
        {arrows.map(
          (p) =>
            p.windDirDeg !== undefined && (
              <g
                key={p.t}
                transform={`translate(${xOf(p.t)},${M.top / 2}) rotate(${p.windDirDeg + 180})`}
              >
                <path
                  d="M0,4 L0,-4 M0,-4 l-2.5,3 M0,-4 l2.5,3"
                  stroke="var(--ink-2)"
                  strokeWidth={1}
                  fill="none"
                />
              </g>
            ),
        )}
        {/* SOG (secondary) then TWS (primary, on top) */}
        <path
          d={linePath((p) => p.sog * MS_TO_KN)}
          stroke={SOG_COLOR}
          strokeWidth={1}
          fill="none"
        />
        <path
          d={linePath((p) => p.tws * MS_TO_KN)}
          stroke={COLOR[model]}
          strokeWidth={1.5}
          fill="none"
        />
        {/* Playback cursor */}
        {cursorT !== null && (
          <line
            x1={xOf(cursorT)}
            x2={xOf(cursorT)}
            y1={M.top}
            y2={M.top + PLOT_H}
            stroke="var(--ink-value)"
            strokeWidth={1}
            opacity={0.8}
          />
        )}
      </svg>
      <div className="flex items-center gap-3 text-xs text-slate-400 font-mono">
        <span>
          <span style={{ color: COLOR[model] }}>—</span> TWS
        </span>
        <span>
          <span style={{ color: SOG_COLOR }}>—</span> SOG
        </span>
        <span className="ml-auto">
          max {summary.maxTwsKn.toFixed(1)} · avg {summary.avgTwsKn.toFixed(1)} kn ·{' '}
          {Math.round(summary.motoringPct)}% motor
        </span>
      </div>
    </section>
  );
}
