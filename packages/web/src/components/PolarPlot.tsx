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
  const tsColor = (twsIdx: number): string => {
    const t = polar.twsBins.length > 1 ? twsIdx / (polar.twsBins.length - 1) : 0;
    // Cool blue at light air → warm orange at heavy air.
    const r = Math.floor(80 + 160 * t);
    const g = Math.floor(180 - 80 * t);
    const b = Math.floor(220 - 120 * t);
    return `rgb(${r},${g},${b})`;
  };

  return (
    <svg
      width={size}
      height={size}
      viewBox={`0 0 ${size} ${size}`}
      className="bg-slate-900 rounded"
    >
      {/* Speed rings */}
      {rings.map((v, i) => (
        <g key={`ring-${i}`}>
          <circle
            cx={cx}
            cy={cy}
            r={v * scale}
            fill="none"
            stroke="rgb(50,55,70)"
            strokeWidth="1"
          />
          <text
            x={cx + 4}
            y={cy - v * scale + 4}
            fill="rgb(100,110,130)"
            fontSize="10"
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
              stroke="rgb(40,45,55)"
              strokeWidth="1"
            />
            <text
              x={cx + (r + 12) * Math.sin(rad)}
              y={cy - (r + 12) * Math.cos(rad)}
              fill="rgb(100,110,130)"
              fontSize="10"
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
      <line x1={cx} y1={margin} x2={cx} y2={size - margin} stroke="rgb(60,70,90)" strokeWidth="1" />
      <line x1={margin} y1={cy} x2={size - margin} y2={cy} stroke="rgb(60,70,90)" strokeWidth="1" />

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
          fill="rgb(255,180,80)"
          stroke="rgb(40,30,10)"
          strokeWidth="1"
        />
      )}

      {/* Current operating point */}
      {currentTwa !== undefined && currentBsp !== undefined && (
        <circle
          cx={polarToCartesian(Math.abs(currentTwa), currentBsp, currentTwa >= 0 ? 1 : -1).x}
          cy={polarToCartesian(Math.abs(currentTwa), currentBsp, currentTwa >= 0 ? 1 : -1).y}
          r={8}
          fill="rgb(120,255,180)"
          stroke="rgb(20,40,30)"
          strokeWidth="2"
        />
      )}

      {/* Current numbers (bottom-left) */}
      <g transform={`translate(${margin / 2},${size - margin / 2})`}>
        <text fill="rgb(200,210,230)" fontSize="11" fontFamily="monospace">
          {currentTws !== undefined ? `TWS ${(currentTws * MS_TO_KNOTS).toFixed(1)}kn` : 'TWS —'}
        </text>
        <text fill="rgb(200,210,230)" fontSize="11" fontFamily="monospace" dy="14">
          {currentTwa !== undefined ? `TWA ${(currentTwa * RAD_TO_DEG).toFixed(0)}°` : 'TWA —'}
          {currentBsp !== undefined ? `  BSP ${(currentBsp * MS_TO_KNOTS).toFixed(2)}kn` : ''}
        </text>
      </g>

      {/* Legend (top-right). Always rendered so the meaning of the dots and
          the curve colour ramp is visible even before any live data flows. */}
      <g transform={`translate(${size - margin / 2 - 110},${margin / 2 + 4})`}>
        <rect
          x="-8"
          y="-12"
          width="118"
          height="74"
          rx="4"
          fill="rgb(15,20,32)"
          fillOpacity="0.75"
          stroke="rgb(50,55,70)"
        />
        {/* Current operating-point dot */}
        <circle cx="0" cy="0" r="6" fill="rgb(120,255,180)" stroke="rgb(20,40,30)" strokeWidth="1.5" />
        <text x="14" y="3" fill="rgb(200,210,230)" fontSize="10" fontFamily="monospace">
          Current
        </text>
        {/* Target operating-point dot */}
        <circle cx="0" cy="16" r="4" fill="rgb(255,180,80)" stroke="rgb(40,30,10)" strokeWidth="1" />
        <text x="14" y="19" fill="rgb(200,210,230)" fontSize="10" fontFamily="monospace">
          Target
        </text>
        {/* TWS curve colour ramp */}
        <defs>
          <linearGradient id="twsLegendGrad" x1="0" x2="1" y1="0" y2="0">
            <stop offset="0%" stopColor="rgb(80,180,220)" />
            <stop offset="100%" stopColor="rgb(240,100,100)" />
          </linearGradient>
        </defs>
        <rect x="-4" y="30" width="100" height="6" fill="url(#twsLegendGrad)" rx="1" />
        <text x="-4" y="48" fill="rgb(150,160,180)" fontSize="9" fontFamily="monospace">
          light
        </text>
        <text x="96" y="48" textAnchor="end" fill="rgb(150,160,180)" fontSize="9" fontFamily="monospace">
          heavy
        </text>
        <text x="46" y="48" textAnchor="middle" fill="rgb(150,160,180)" fontSize="9" fontFamily="monospace">
          TWS
        </text>
      </g>
    </svg>
  );
}
