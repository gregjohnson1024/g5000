import type { AisTarget } from '@g5000/core';
import type { CpaResult } from '@g5000/compute';
import { MS_TO_KN, RAD_TO_DEG } from '../../lib/units';

const NM = 1852;
/**
 * Time horizon (minutes) used to project each vessel forward along its COG at
 * its own SOG. Length = SOG × this. Matches standard ARPA radar convention of
 * a tactical-horizon vector, scaled to sailing speeds: at 10 kn the arrow is
 * ~5 NM, at 20 kn ~10 NM. Clipped to the visible range so fast targets near
 * the edge don't run off-canvas.
 */
const COG_EXTENSION_MINUTES = 30;
/**
 * SOG floor (knots) below which a vessel is treated as stationary: rendered
 * with a diamond icon and no COG extension. COG is meaningless at very low
 * speeds (sensor noise dominates the bearing). 0.5 kn is well above the noise
 * floor and below realistic underway speeds for any AIS-equipped boat.
 */
const STATIONARY_THRESHOLD_KN = 0.5;

interface TargetWithCpa {
  target: AisTarget;
  cpa: CpaResult | null;
  stale: boolean;
}

interface RadarScopeProps {
  svgSize: number;
  svgRadius: number;
  center: number;
  metersToPx: number;
  ringRadii: number[];
  canvasRotationDeg: number;
  targetsWithCpa: TargetWithCpa[];
  isThreat: (cpa: CpaResult | null) => boolean;
  selectedMmsi: number | null;
  setSelectedMmsi: (mmsi: number | null) => void;
  ownSog: number;
  ownCog: number;
  rangeNm: number;
}

export function RadarScope({
  svgSize,
  svgRadius,
  center,
  metersToPx,
  ringRadii,
  canvasRotationDeg,
  targetsWithCpa,
  isThreat,
  selectedMmsi,
  setSelectedMmsi,
  ownSog,
  ownCog,
  rangeNm,
}: RadarScopeProps) {
  return (
    <svg
      width={svgSize}
      height={svgSize}
      viewBox={`0 0 ${svgSize} ${svgSize}`}
      className="bg-slate-950 border border-slate-800 rounded"
    >
      {/* Rotate the whole field for course-up mode. */}
      <g transform={`rotate(${canvasRotationDeg} ${center} ${center})`}>
        {/* Range rings */}
        {ringRadii.map((rNm) => (
          <circle
            key={rNm}
            cx={center}
            cy={center}
            r={rNm * NM * metersToPx}
            fill="none"
            stroke="#334155"
            strokeDasharray="4 4"
          />
        ))}
        {/* Outer ring at full range */}
        <circle cx={center} cy={center} r={svgRadius} fill="none" stroke="#475569" />
        {/* Crosshair */}
        <line
          x1={center}
          y1={center - svgRadius}
          x2={center}
          y2={center + svgRadius}
          stroke="#1e293b"
        />
        <line
          x1={center - svgRadius}
          y1={center}
          x2={center + svgRadius}
          y2={center}
          stroke="#1e293b"
        />

        {/* Predicted CPA markers + connector lines (rendered behind
            the target triangles so the triangle stays the dominant
            visual). Only drawn for threats with a positive TCPA — past
            CPAs aren't relevant to a tactical decision. */}
        {targetsWithCpa.map(({ target, cpa }) => {
          if (!cpa || !isThreat(cpa)) return null;
          if (cpa.tcpaSeconds <= 0) return null;
          // Target's current relative pos in canvas pixels.
          const dist = cpa.rangeMeters * metersToPx;
          const targetX = center + dist * Math.sin(cpa.bearingRadians);
          const targetY = center - dist * Math.cos(cpa.bearingRadians);
          // Target's predicted relative pos at TCPA, in canvas pixels.
          // The compute helper returns this in own-centred east/north
          // meters; convert to canvas (east → +x, north → -y).
          const cpaX = center + cpa.cpaRelativeEast * metersToPx;
          const cpaY = center - cpa.cpaRelativeNorth * metersToPx;
          // Clamp drawing to the visible chart area — if the CPA point
          // is off-canvas the dashed connector still terminates at the
          // edge, but we skip the marker.
          const cpaInBounds = Math.hypot(cpaX - center, cpaY - center) < svgRadius + 12;
          return (
            <g key={`cpa-${target.mmsi}`} pointerEvents="none">
              <line
                x1={targetX}
                y1={targetY}
                x2={cpaX}
                y2={cpaY}
                stroke="#fbbf24"
                strokeWidth="1"
                strokeDasharray="3 3"
              />
              {cpaInBounds && (
                <>
                  {/* CPA cross-hair */}
                  <line
                    x1={cpaX - 6}
                    y1={cpaY}
                    x2={cpaX + 6}
                    y2={cpaY}
                    stroke="#fbbf24"
                    strokeWidth="1.5"
                  />
                  <line
                    x1={cpaX}
                    y1={cpaY - 6}
                    x2={cpaX}
                    y2={cpaY + 6}
                    stroke="#fbbf24"
                    strokeWidth="1.5"
                  />
                  <circle
                    cx={cpaX}
                    cy={cpaY}
                    r={Math.max(3, (cpa.cpaMeters * metersToPx) / 2)}
                    fill="none"
                    stroke="#fbbf24"
                    strokeWidth="0.5"
                    strokeDasharray="2 2"
                    opacity="0.5"
                  />
                </>
              )}
            </g>
          );
        })}

        {/* AIS targets */}
        {targetsWithCpa.map(({ target, cpa, stale }) => {
          if (!cpa) return null;
          // Position in the (world-frame) canvas: bearing 0 = up (N).
          const dist = cpa.rangeMeters * metersToPx;
          if (dist > svgRadius) return null;
          const x = center + dist * Math.sin(cpa.bearingRadians);
          const y = center - dist * Math.cos(cpa.bearingRadians);
          // Stale targets never count as threats (last position is too
          // old to be tactically meaningful).
          const threat = !stale && isThreat(cpa);
          const cogDeg = ((target.cog ?? 0) * RAD_TO_DEG) % 360;
          // Stationary vessels (under 0.5 kn or no SOG) render with a
          // diamond icon and no COG leader — COG isn't meaningful at
          // that speed.
          const sogKn = (target.sog ?? 0) * MS_TO_KN;
          const stationary = !Number.isFinite(sogKn) || sogKn < STATIONARY_THRESHOLD_KN;
          // SOG-proportional leader: SOG (m/s) × horizon (s) → metres,
          // then scaled to canvas px. Clipped to the visible chart
          // so fast vessels near the edge don't shoot off-canvas.
          const leaderLen = stationary
            ? 0
            : Math.min(
                (target.sog ?? 0) * COG_EXTENSION_MINUTES * 60 * metersToPx,
                svgRadius - dist + 7,
              );
          const fill = stale ? 'none' : threat ? '#ef4444' : '#94a3b8';
          const stroke = stale ? '#64748b' : '#0f172a';
          const leaderStroke = stale ? '#475569' : threat ? '#ef4444' : '#475569';
          return (
            <g
              key={target.mmsi}
              onClick={() => setSelectedMmsi(target.mmsi)}
              style={{ cursor: 'pointer' }}
              opacity={stale ? 0.55 : 1}
            >
              <g transform={`translate(${x}, ${y})`}>
                {stationary ? (
                  // Diamond, not rotated — directionless icon for
                  // anchored/moored vessels.
                  <polygon
                    points="0,-9 9,0 0,9 -9,0"
                    fill={fill}
                    stroke={stroke}
                    strokeWidth={stale ? 1.5 : 1}
                    strokeDasharray={stale ? '3 2' : undefined}
                  />
                ) : (
                  <g transform={`rotate(${cogDeg})`}>
                    <polygon
                      points="0,-14 -8,10 8,10"
                      fill={fill}
                      stroke={stroke}
                      strokeWidth={stale ? 1.5 : 1}
                      strokeDasharray={stale ? '3 2' : undefined}
                    />
                    {leaderLen > 1 && (
                      <line
                        x1="0"
                        y1="-14"
                        x2="0"
                        y2={-14 - leaderLen}
                        stroke={leaderStroke}
                        strokeWidth="1.5"
                        strokeDasharray={stale ? '4 3' : undefined}
                      />
                    )}
                  </g>
                )}
                {selectedMmsi === target.mmsi && (
                  <circle r="11" fill="none" stroke="#fbbf24" strokeWidth="1.5" />
                )}
                {threat && (
                  <circle r="14" fill="none" stroke="#ef4444" strokeWidth="2">
                    <animate
                      attributeName="r"
                      values="10;18;10"
                      dur="2s"
                      repeatCount="indefinite"
                    />
                    <animate
                      attributeName="opacity"
                      values="1;0;1"
                      dur="2s"
                      repeatCount="indefinite"
                    />
                  </circle>
                )}
              </g>
            </g>
          );
        })}

        {/* Own boat — at center. Triangle and SOG-proportional leader
            both rotated by COG so the apparent direction matches every
            other vessel on the screen. (HDG is published separately and
            shown in the helm view; on the radar we want a consistent
            COG-based picture.) Under 0.5 kn we render a diamond with no
            leader, same convention as AIS targets. */}
        {(() => {
          const ownSogKn = ownSog * MS_TO_KN;
          const ownStationary = !Number.isFinite(ownSogKn) || ownSogKn < STATIONARY_THRESHOLD_KN;
          if (ownStationary) {
            return (
              <g transform={`translate(${center}, ${center})`}>
                <polygon
                  points="0,-9 9,0 0,9 -9,0"
                  fill="#fbbf24"
                  stroke="#0f172a"
                  strokeWidth="1"
                />
              </g>
            );
          }
          const ownCogDeg = (ownCog * RAD_TO_DEG) % 360;
          const ownLeaderLen = Math.min(
            ownSog * COG_EXTENSION_MINUTES * 60 * metersToPx,
            svgRadius - 14,
          );
          return (
            <g transform={`translate(${center}, ${center}) rotate(${ownCogDeg})`}>
              {ownLeaderLen > 1 && (
                <line
                  x1="0"
                  y1="-14"
                  x2="0"
                  y2={-14 - ownLeaderLen}
                  stroke="#fbbf24"
                  strokeWidth="1.5"
                  strokeOpacity="0.85"
                />
              )}
              <polygon points="0,-14 -8,10 8,10" fill="#fbbf24" stroke="#0f172a" strokeWidth="1" />
            </g>
          );
        })()}
      </g>

      {/* North indicator — UNrotated; arrow points to where north is on
          the canvas. In north-up it's straight up; in course-up it points
          back relative to own's heading. */}
      <g transform={`translate(30, 30)`}>
        <circle r="18" fill="#0f172a" stroke="#334155" />
        <g transform={`rotate(${canvasRotationDeg})`}>
          <polygon points="0,-12 -4,4 0,1 4,4" fill="#fbbf24" stroke="#0f172a" strokeWidth="0.5" />
        </g>
        <text x="0" y="-22" textAnchor="middle" fontSize="10" fill="#94a3b8" fontFamily="monospace">
          N
        </text>
      </g>

      {/* Range-ring scale labels */}
      {ringRadii.map((rNm, i) => (
        <text
          key={rNm}
          x={center + 4}
          y={center - rNm * NM * metersToPx - 2}
          fontSize="9"
          fill="#475569"
          fontFamily="monospace"
        >
          {rNm.toFixed(rNm < 1 ? 1 : 0)}
          {i === ringRadii.length - 1 ? ' NM' : ''}
        </text>
      ))}
      <text
        x={center + 4}
        y={center - svgRadius - 2}
        fontSize="9"
        fill="#94a3b8"
        fontFamily="monospace"
      >
        {rangeNm} NM
      </text>
    </svg>
  );
}
