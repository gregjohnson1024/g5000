'use client';

import type { PolarTable } from '@g5000/db';

const MS_TO_KNOTS = 1 / 0.514444;
const RAD_TO_DEG = 180 / Math.PI;

export interface PolarPlotProps {
  polar: PolarTable;
  /** Current operating point — both must be defined for the dot to render. */
  currentTwa?: number;
  currentTws?: number;
  currentBsp?: number;
  /** Target point overlay. */
  targetTwa?: number;
  targetBsp?: number;
  /** Pixel size of the square canvas. Default 480. */
  size?: number;
}

/**
 * SVG polar plot. Center = boat; up = 0° TWA (into wind); down = 180° TWA.
 * TWS curves are drawn for each row in the polar table, mirrored across the
 * centerline so the chart shows both port (left) and starboard (right).
 */
export function PolarPlot({
  polar,
  currentTwa,
  currentTws,
  currentBsp,
  targetTwa,
  targetBsp,
  size = 480,
}: PolarPlotProps) {
  const cx = size / 2;
  const cy = size / 2;
  const margin = 40;
  const maxBsp = Math.max(1, ...polar.boatSpeed.flat()); // m/s
  const scale = (size / 2 - margin) / maxBsp;

  // Convert (TWA radians, BSP m/s, side) → (x, y) in SVG coords.
  // TWA = 0 is straight up, sweeps clockwise. side = -1 for port, +1 for starboard.
  const polarToCartesian = (twa: number, bsp: number, side: 1 | -1): { x: number; y: number } => ({
    x: cx + side * bsp * Math.sin(twa) * scale,
    y: cy - bsp * Math.cos(twa) * scale,
  });

  // Speed rings — every 2 m/s (≈ 4 kn).
  const ringStepMs = 2;
  const ringMaxMs = Math.ceil(maxBsp);
  const rings: number[] = [];
  for (let v = ringStepMs; v <= ringMaxMs; v += ringStepMs) rings.push(v);

  // TWS curves (one per TWS bin).
  // Colour ramp: info (calm/light) → danger (strong/heavy), matching the legend gradient.
  // Steps across the --series-* tokens so the ramp inherits the active theme.
  const SERIES_TOKENS = [
    'var(--series-1)', // sky/blue in DAY
    'var(--series-3)', // emerald/green in DAY
    'var(--series-8)', // yellow in DAY
    'var(--series-6)', // rose in DAY
    'var(--danger)', // red in DAY
  ] as const;
  const tsColor = (twsIdx: number): string => {
    if (polar.twsBins.length <= 1) return SERIES_TOKENS[0]!;
    const t = twsIdx / (polar.twsBins.length - 1);
    const idx = Math.min(
      SERIES_TOKENS.length - 1,
      Math.floor(t * (SERIES_TOKENS.length - 1) + 0.5),
    );
    return SERIES_TOKENS[idx]!;
  };

  return (
    <svg
      width={size}
      height={size}
      viewBox={`0 0 ${size} ${size}`}
      className="bg-surface-sunken [border-radius:var(--r-panel)]"
    >
      {/* Speed rings */}
      {rings.map((v, i) => (
        <g key={`ring-${i}`}>
          <circle
            cx={cx}
            cy={cy}
            r={v * scale}
            fill="none"
            stroke="var(--hairline-strong)"
            strokeWidth="1"
          />
          <text
            x={cx + 4}
            y={cy - v * scale + 4}
            fill="var(--ink-3)"
            fontSize="15"
            fontFamily="monospace"
          >
            {(v * MS_TO_KNOTS).toFixed(0)}kn
          </text>
        </g>
      ))}

      {/* Radial lines at common TWAs */}
      {[30, 60, 90, 120, 150].map((deg) => {
        const rad = (deg * Math.PI) / 180;
        const r = size / 2 - margin;
        return (
          <g key={`radial-${deg}`}>
            <line
              x1={cx + r * Math.sin(rad)}
              y1={cy - r * Math.cos(rad)}
              x2={cx - r * Math.sin(rad)}
              y2={cy - r * Math.cos(rad)}
              stroke="var(--hairline)"
              strokeWidth="1"
            />
            <text
              x={cx + (r + 12) * Math.sin(rad)}
              y={cy - (r + 12) * Math.cos(rad)}
              fill="var(--ink-3)"
              fontSize="15"
              fontFamily="monospace"
              textAnchor="middle"
              dominantBaseline="central"
            >
              {deg}°
            </text>
          </g>
        );
      })}

      {/* Vertical and horizontal axes */}
      <line
        x1={cx}
        y1={margin}
        x2={cx}
        y2={size - margin}
        stroke="var(--hairline-strong)"
        strokeWidth="1"
      />
      <line
        x1={margin}
        y1={cy}
        x2={size - margin}
        y2={cy}
        stroke="var(--hairline-strong)"
        strokeWidth="1"
      />

      {/* TWS curves */}
      {polar.boatSpeed.map((row, twsIdx) => {
        const points: string[] = [];
        for (let twaIdx = 0; twaIdx < polar.twaBins.length; twaIdx++) {
          const twa = polar.twaBins[twaIdx]!;
          const bsp = row[twaIdx]!;
          const { x, y } = polarToCartesian(twa, bsp, 1);
          points.push(`${x},${y}`);
        }
        // Mirror to port side.
        const portPoints: string[] = [];
        for (let twaIdx = polar.twaBins.length - 1; twaIdx >= 0; twaIdx--) {
          const twa = polar.twaBins[twaIdx]!;
          const bsp = row[twaIdx]!;
          const { x, y } = polarToCartesian(twa, bsp, -1);
          portPoints.push(`${x},${y}`);
        }
        const allPoints = [...points, ...portPoints].join(' ');
        return (
          <polygon
            key={`curve-${twsIdx}`}
            points={allPoints}
            fill="none"
            stroke={tsColor(twsIdx)}
            strokeWidth="1.5"
            opacity="0.85"
          />
        );
      })}

      {/* Target point (lower z than current) */}
      {targetTwa !== undefined && targetBsp !== undefined && (
        <circle
          cx={polarToCartesian(Math.abs(targetTwa), targetBsp, targetTwa >= 0 ? 1 : -1).x}
          cy={polarToCartesian(Math.abs(targetTwa), targetBsp, targetTwa >= 0 ? 1 : -1).y}
          r={5}
          fill="var(--accent-ink)"
          stroke="var(--surface-sunken)"
          strokeWidth="1"
        />
      )}

      {/* Current operating point */}
      {currentTwa !== undefined && currentBsp !== undefined && (
        <circle
          cx={polarToCartesian(Math.abs(currentTwa), currentBsp, currentTwa >= 0 ? 1 : -1).x}
          cy={polarToCartesian(Math.abs(currentTwa), currentBsp, currentTwa >= 0 ? 1 : -1).y}
          r={8}
          fill="var(--stbd)"
          stroke="var(--surface-sunken)"
          strokeWidth="2"
        />
      )}

      {/* Current numbers (bottom-left) */}
      <g transform={`translate(${margin / 2},${size - margin / 2})`}>
        <text fill="var(--ink)" fontSize="16" fontFamily="monospace">
          {currentTws !== undefined ? `TWS ${(currentTws * MS_TO_KNOTS).toFixed(1)}kn` : 'TWS —'}
        </text>
        <text fill="var(--ink)" fontSize="16" fontFamily="monospace" dy="20">
          {currentTwa !== undefined ? `TWA ${(currentTwa * RAD_TO_DEG).toFixed(0)}°` : 'TWA —'}
          {currentBsp !== undefined ? `  BSP ${(currentBsp * MS_TO_KNOTS).toFixed(2)}kn` : ''}
        </text>
      </g>

      {/* Legend (top-right). Always rendered so the meaning of the dots and
          the curve colour ramp is visible even before any live data flows. */}
      <g transform={`translate(${size - margin / 2 - 150},${margin / 2 + 4})`}>
        <rect
          x="-10"
          y="-16"
          width="160"
          height="110"
          rx="4"
          fill="var(--surface)"
          fillOpacity="0.85"
          stroke="var(--hairline-strong)"
        />
        {/* Current operating-point dot */}
        <circle
          cx="0"
          cy="0"
          r="7"
          fill="var(--stbd)"
          stroke="var(--surface-sunken)"
          strokeWidth="1.5"
        />
        <text x="16" y="5" fill="var(--ink)" fontSize="15" fontFamily="monospace">
          Current
        </text>
        {/* Target operating-point dot */}
        <circle
          cx="0"
          cy="24"
          r="5"
          fill="var(--accent-ink)"
          stroke="var(--surface-sunken)"
          strokeWidth="1"
        />
        <text x="16" y="29" fill="var(--ink)" fontSize="15" fontFamily="monospace">
          Target
        </text>
        {/* TWS curve colour ramp — info (light/calm) → danger (heavy/strong) */}
        <defs>
          <linearGradient id="twsLegendGrad" x1="0" x2="1" y1="0" y2="0">
            <stop offset="0%" stopColor="var(--info)" />
            <stop offset="100%" stopColor="var(--danger)" />
          </linearGradient>
        </defs>
        <rect x="-4" y="48" width="140" height="8" fill="url(#twsLegendGrad)" rx="1" />
        <text x="-4" y="76" fill="var(--ink-2)" fontSize="13" fontFamily="monospace">
          light
        </text>
        <text
          x="136"
          y="76"
          textAnchor="end"
          fill="var(--ink-2)"
          fontSize="13"
          fontFamily="monospace"
        >
          heavy
        </text>
        <text
          x="66"
          y="76"
          textAnchor="middle"
          fill="var(--ink-2)"
          fontSize="13"
          fontFamily="monospace"
        >
          TWS
        </text>
      </g>
    </svg>
  );
}
