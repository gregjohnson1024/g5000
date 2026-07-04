'use client';

import type { JsonSafeSample } from '@g5000/core';
import { useGust } from '../../../lib/gust';
import { RAD_TO_DEG, MS_TO_KN, wrap360 } from '../../../lib/units';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function scalar(s: JsonSafeSample | undefined): number | null {
  if (!s || s.value.kind !== 'scalar') return null;
  return s.value.value;
}

function fmtKn(ms: number | null): string {
  if (ms === null) return '—';
  return (ms * MS_TO_KN).toFixed(1);
}

// ---------------------------------------------------------------------------
// Compass ring geometry
// ---------------------------------------------------------------------------

const CX = 100; // SVG viewBox centre x
const CY = 100; // SVG viewBox centre y
const DIAL_R = 82; // outer ring radius
const TICK_MAJOR_LEN = 10;
const TICK_MINOR_LEN = 5;
const LABEL_R = DIAL_R - TICK_MAJOR_LEN - 10; // radius for N/E/S/W text
const INNER_R = DIAL_R - TICK_MAJOR_LEN - 2; // inner edge of tick ring

// Generate compass tick marks and cardinal labels (drawn in ring-local coords;
// the ring group is rotated by -headingDeg so the bow stays at 12 o'clock).
function compassTicks(): React.ReactElement[] {
  const els: React.ReactElement[] = [];
  for (let deg = 0; deg < 360; deg += 5) {
    const isMajor = deg % 45 === 0;
    const isCard = deg % 90 === 0;
    const len = isMajor ? TICK_MAJOR_LEN : TICK_MINOR_LEN;
    const rad = (deg - 90) * (Math.PI / 180); // 0° at top
    const x1 = CX + DIAL_R * Math.cos(rad);
    const y1 = CY + DIAL_R * Math.sin(rad);
    const x2 = CX + (DIAL_R - len) * Math.cos(rad);
    const y2 = CY + (DIAL_R - len) * Math.sin(rad);
    els.push(
      <line
        key={`tick-${deg}`}
        x1={x1}
        y1={y1}
        x2={x2}
        y2={y2}
        stroke={isMajor ? '#94a3b8' : '#334155'}
        strokeWidth={isMajor ? 1.2 : 0.7}
      />,
    );
    if (isCard) {
      const label = ['N', 'E', 'S', 'W'][deg / 90]!;
      const lx = CX + LABEL_R * Math.cos(rad);
      const ly = CY + LABEL_R * Math.sin(rad);
      els.push(
        <text
          key={`lbl-${deg}`}
          x={lx}
          y={ly}
          textAnchor="middle"
          dominantBaseline="central"
          fontSize={9}
          fill="#64748b"
          fontFamily="ui-monospace,monospace"
        >
          {label}
        </text>,
      );
    }
  }
  return els;
}

// Pre-build the ticks once (they're pure geometry, headingDeg is applied via SVG transform).
const COMPASS_TICKS = compassTicks();

// ---------------------------------------------------------------------------
// Wind needle
// ---------------------------------------------------------------------------

/** Arrow pointing upward (toward 12 o'clock) in local coords, centred at origin. */
function WindNeedle({ r }: { r: number }): React.ReactElement {
  const tip = -r * 0.72; // negative y = up
  const base = r * 0.4;
  const hw = 5; // half-width at base
  return (
    <g>
      {/* shaft */}
      <line
        x1={0}
        y1={base}
        x2={0}
        y2={tip}
        stroke="#38bdf8"
        strokeWidth={2}
        strokeLinecap="round"
      />
      {/* arrowhead */}
      <polygon points={`0,${tip - 6} ${-4},${tip + 2} ${4},${tip + 2}`} fill="#38bdf8" />
      {/* tail indicator (small fin at base so we can tell which end) */}
      <line x1={-hw} y1={base} x2={hw} y2={base} stroke="#38bdf8" strokeWidth={1.5} />
    </g>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export function WindDial({
  channels,
}: {
  channels: ReadonlyMap<string, JsonSafeSample>;
}): React.ReactElement {
  // Raw samples
  const awaSample = channels.get('wind.apparent.angle');
  const awsSample = channels.get('wind.apparent.speed');
  const hdgMagSample = channels.get('boat.heading.magnetic');
  const hdgTrueSample = channels.get('boat.heading.true');

  // Scalars (all radians / m/s)
  const awaRad = scalar(awaSample); // relative to bow; positive = starboard
  const awsMs = scalar(awsSample); // m/s
  const hdgRad = scalar(hdgMagSample) ?? scalar(hdgTrueSample); // radians

  // Gusts (m/s)
  const gust10Ms = useGust(awsSample, 600_000);
  const gust60Ms = useGust(awsSample, 3_600_000);

  // Derived display values
  const awsDeg = awaRad !== null ? awaRad * RAD_TO_DEG : null; // signed degrees
  const awsKn = awsMs !== null ? awsMs * MS_TO_KN : null;
  const awsDisplay = awsKn !== null ? awsKn.toFixed(1) : '—';

  // AWA for needle rotation: 0° = ahead (12 o'clock); positive = clockwise (starboard)
  const needleRotDeg = awaRad !== null ? awaRad * RAD_TO_DEG : null;

  // Port / Starboard label
  const side = awsDeg !== null ? (awsDeg >= 0 ? 'STARBOARD' : 'PORT') : null;
  const absDeg = awsDeg !== null ? Math.abs(awsDeg) : null;
  const sideColor = side === 'STARBOARD' ? '#34d399' : side === 'PORT' ? '#f87171' : '#64748b';

  // AWA badge (0–360, bow = 0, starboard = 0–180)
  const awaBadgeDeg = awsDeg !== null ? wrap360(awsDeg) : null;

  // Course-up ring rotation: rotate the ring so current heading sits at top.
  // ring rotation = −headingDeg (compass rotates opposite to heading)
  const hdgDeg = hdgRad !== null ? hdgRad * RAD_TO_DEG : 0;
  const ringRotDeg = hdgRad !== null ? -hdgDeg : 0;

  return (
    <div className="bg-slate-900 border border-slate-800 rounded-lg p-3 flex flex-col gap-1">
      <div className="flex items-center justify-between">
        <span className="text-xs uppercase tracking-wide text-slate-500 font-medium">
          Apparent Wind
        </span>
        {hdgRad !== null && (
          <span className="text-xs text-slate-600 font-mono">
            HDG {String(Math.round(wrap360(hdgDeg))).padStart(3, '0')}°
          </span>
        )}
      </div>

      {/* SVG dial */}
      <div className="flex justify-center">
        <svg viewBox="0 0 200 200" width="220" height="220" aria-label="Apparent wind compass dial">
          {/* Background circle */}
          <circle cx={CX} cy={CY} r={DIAL_R} fill="#0f172a" stroke="#1e293b" strokeWidth={1} />

          {/* Compass ring (rotated so heading stays at top) */}
          <g transform={`rotate(${ringRotDeg}, ${CX}, ${CY})`}>{COMPASS_TICKS}</g>

          {/* Inner ring border */}
          <circle cx={CX} cy={CY} r={INNER_R} fill="none" stroke="#1e293b" strokeWidth={0.8} />

          {/* Bow indicator — fixed triangle at 12 o'clock */}
          <polygon
            points={`${CX},${CY - DIAL_R + 2} ${CX - 4},${CY - DIAL_R + 10} ${CX + 4},${CY - DIAL_R + 10}`}
            fill="#94a3b8"
          />

          {/* Wind needle (rotated by AWA from bow) */}
          {needleRotDeg !== null && (
            <g transform={`rotate(${needleRotDeg}, ${CX}, ${CY})`}>
              <WindNeedle r={INNER_R - 4} />
            </g>
          )}

          {/* Centre dot */}
          <circle cx={CX} cy={CY} r={3} fill="#64748b" />

          {/* AWS — big number */}
          <text
            x={CX}
            y={CY - 8}
            textAnchor="middle"
            dominantBaseline="central"
            fontSize={28}
            fontWeight="700"
            fill="#f1f5f9"
            fontFamily="ui-monospace,monospace"
          >
            {awsDisplay}
          </text>
          <text
            x={CX}
            y={CY + 14}
            textAnchor="middle"
            dominantBaseline="central"
            fontSize={9}
            fill="#64748b"
            fontFamily="ui-sans-serif,sans-serif"
            letterSpacing="0.08em"
          >
            KTS
          </text>

          {/* Port / Starboard readout */}
          {side !== null && absDeg !== null && (
            <text
              x={CX}
              y={CY + 30}
              textAnchor="middle"
              dominantBaseline="central"
              fontSize={8}
              fill={sideColor}
              fontFamily="ui-sans-serif,sans-serif"
              fontWeight="600"
              letterSpacing="0.06em"
            >
              {side} {Math.round(absDeg)}°
            </text>
          )}

          {/* AWA badge */}
          {awaBadgeDeg !== null && (
            <>
              <rect
                x={CX - 22}
                y={CY + 41}
                width={44}
                height={14}
                rx={3}
                fill="#1e293b"
                stroke="#334155"
                strokeWidth={0.8}
              />
              <text
                x={CX}
                y={CY + 48}
                textAnchor="middle"
                dominantBaseline="central"
                fontSize={8}
                fill="#94a3b8"
                fontFamily="ui-monospace,monospace"
              >
                AWA {String(Math.round(awaBadgeDeg)).padStart(3, '0')}°
              </text>
            </>
          )}
        </svg>
      </div>

      {/* Gust footers */}
      <div className="flex justify-between text-xs text-slate-400 font-mono px-1 pt-0 pb-1">
        <div className="flex flex-col items-start">
          <span className="text-slate-600 text-[10px] uppercase tracking-wide">
            Max Gust 10 min
          </span>
          <span className="text-slate-200">{fmtKn(gust10Ms)} kts</span>
        </div>
        <div className="flex flex-col items-end">
          <span className="text-slate-600 text-[10px] uppercase tracking-wide">Max Gust 1 hr</span>
          <span className="text-slate-200">{fmtKn(gust60Ms)} kts</span>
        </div>
      </div>
    </div>
  );
}
