'use client';

import { useEffect, useMemo, useState } from 'react';
import { computeCpa, type CpaResult } from '@g5000/compute';
import type { AisTarget, JsonSafeSample } from '@g5000/core';
import { useSse } from '../../hooks/use-sse';

const NM = 1852;
const MS_TO_KN = 1 / 0.514444;
const RAD_TO_DEG = 180 / Math.PI;
const RANGE_OPTIONS_NM = [1, 2, 4, 8, 16];
const LEADER_MINUTES = 6;
const LEADER_SECONDS = LEADER_MINUTES * 60;

interface AisAlarmConfig {
  enabled: boolean;
  cpaMeters: number;
  tcpaSeconds: number;
}

const DEFAULT_ALARM: AisAlarmConfig = {
  enabled: true,
  cpaMeters: NM,
  tcpaSeconds: 600,
};

/** Narrow a Sample to its geo lat/lon, or null if it's missing/wrong-kind. */
function geoValue(s: JsonSafeSample | undefined): { lat: number; lon: number } | null {
  if (!s || s.value.kind !== 'geo') return null;
  return s.value.value;
}

/** Narrow a Sample to its scalar number, or null if it's missing/wrong-kind. */
function scalarValue(s: JsonSafeSample | undefined): number | null {
  if (!s || s.value.kind !== 'scalar') return null;
  return s.value.value;
}

function fmtTcpa(seconds: number): string {
  if (seconds <= 0) return '—';
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}:${String(secs).padStart(2, '0')}`;
}

export default function ChartPage() {
  const { channels } = useSse();
  const [targets, setTargets] = useState<AisTarget[]>([]);
  const [alarmConfig, setAlarmConfig] = useState<AisAlarmConfig>(DEFAULT_ALARM);
  const [rangeNm, setRangeNm] = useState(4);
  const [northUp, setNorthUp] = useState(false);
  const [selectedMmsi, setSelectedMmsi] = useState<number | null>(null);
  const [showAlarmEdit, setShowAlarmEdit] = useState(false);
  const [draftCpaNm, setDraftCpaNm] = useState(1);
  const [draftTcpaMin, setDraftTcpaMin] = useState(10);

  // Poll AIS targets every 2s
  useEffect(() => {
    let cancelled = false;
    const fetchTargets = async () => {
      try {
        const r = await fetch('/api/ais/targets', { cache: 'no-store' });
        if (!r.ok || cancelled) return;
        const j = (await r.json()) as { targets: AisTarget[] };
        if (!cancelled) setTargets(j.targets);
      } catch {
        /* swallow — next tick retries */
      }
    };
    void fetchTargets();
    const id = setInterval(fetchTargets, 2000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, []);

  // Load alarm config once
  useEffect(() => {
    void fetch('/api/ais/alarm-config')
      .then((r) => (r.ok ? r.json() : null))
      .then((c) => {
        if (c && typeof c === 'object') {
          const cfg = c as AisAlarmConfig;
          setAlarmConfig(cfg);
          setDraftCpaNm(cfg.cpaMeters / NM);
          setDraftTcpaMin(cfg.tcpaSeconds / 60);
        }
      })
      .catch(() => {});
  }, []);

  // Own boat state from SSE
  const ownPos = geoValue(channels.get('nav.gps.position'));
  const ownCog = scalarValue(channels.get('nav.gps.cog')) ?? 0;
  const ownSog = scalarValue(channels.get('nav.gps.sog')) ?? 0;
  const ownHeading = scalarValue(channels.get('boat.heading.magnetic')) ?? ownCog;

  // Compute CPA per target — depends on own pos + every target's pos/cog/sog.
  const targetsWithCpa = useMemo(() => {
    if (!ownPos) return [];
    return targets.map((t) => {
      if (t.lat === undefined || t.lon === undefined) {
        return { target: t, cpa: null as CpaResult | null };
      }
      const own = { lat: ownPos.lat, lon: ownPos.lon, cog: ownCog, sog: ownSog };
      const tgt = { lat: t.lat, lon: t.lon, cog: t.cog ?? 0, sog: t.sog ?? 0 };
      return { target: t, cpa: computeCpa(own, tgt) };
    });
  }, [targets, ownPos, ownCog, ownSog]);

  const svgSize = 600;
  const svgRadius = 280;
  const metersToPx = svgRadius / (rangeNm * NM);
  const center = svgSize / 2;
  // Range-ring radii to draw inside the canvas. We draw at half-, three-quarter-
  // and full-range marks.
  const ringRadii = [rangeNm * 0.25, rangeNm * 0.5, rangeNm * 0.75].filter((r) => r > 0);

  const isThreat = (cpa: CpaResult | null): boolean =>
    !!cpa &&
    alarmConfig.enabled &&
    cpa.cpaMeters < alarmConfig.cpaMeters &&
    cpa.tcpaSeconds > 0 &&
    cpa.tcpaSeconds < alarmConfig.tcpaSeconds;

  // Course-up rotation: in course-up mode, the canvas rotates clockwise by
  // own's heading so own's heading points up. North-up means no rotation.
  const canvasRotationDeg = northUp ? 0 : -ownHeading * RAD_TO_DEG;

  const toggleAlarmEnabled = async () => {
    const next = { ...alarmConfig, enabled: !alarmConfig.enabled };
    setAlarmConfig(next);
    await fetch('/api/ais/alarm-config', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ enabled: next.enabled }),
    });
  };

  const saveThresholds = async () => {
    const cpaMeters = Math.max(1, draftCpaNm * NM);
    const tcpaSeconds = Math.max(1, draftTcpaMin * 60);
    const next = { ...alarmConfig, cpaMeters, tcpaSeconds };
    setAlarmConfig(next);
    setShowAlarmEdit(false);
    await fetch('/api/ais/alarm-config', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ cpaMeters, tcpaSeconds }),
    });
  };

  const selectedRow =
    selectedMmsi !== null ? targetsWithCpa.find((r) => r.target.mmsi === selectedMmsi) : null;

  return (
    <main className="p-4 max-w-7xl mx-auto text-slate-100">
      <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
        <h1 className="text-2xl font-semibold">Chart</h1>
        <div className="flex gap-3 items-center text-sm font-mono flex-wrap">
          <label className="text-slate-300">
            Range:&nbsp;
            <select
              value={rangeNm}
              onChange={(e) => setRangeNm(Number(e.target.value))}
              className="bg-slate-800 border border-slate-700 rounded px-2 py-1"
            >
              {RANGE_OPTIONS_NM.map((n) => (
                <option key={n} value={n}>
                  {n} NM
                </option>
              ))}
            </select>
          </label>
          <label className="text-slate-300 cursor-pointer">
            <input
              type="checkbox"
              checked={northUp}
              onChange={(e) => setNorthUp(e.target.checked)}
            />
            &nbsp;North up
          </label>
          <button
            type="button"
            onClick={() => void toggleAlarmEnabled()}
            className={`px-2 py-1 rounded text-xs ${
              alarmConfig.enabled
                ? 'bg-emerald-700 hover:bg-emerald-600'
                : 'bg-slate-700 hover:bg-slate-600'
            }`}
          >
            Alarm {alarmConfig.enabled ? 'ON' : 'OFF'}
          </button>
          <button
            type="button"
            onClick={() => setShowAlarmEdit((v) => !v)}
            className="px-2 py-1 rounded text-xs bg-slate-800 border border-slate-700 hover:bg-slate-700"
          >
            CPA {(alarmConfig.cpaMeters / NM).toFixed(1)} NM · TCPA{' '}
            {Math.round(alarmConfig.tcpaSeconds / 60)} min
          </button>
        </div>
      </div>

      {showAlarmEdit && (
        <div className="mb-3 bg-slate-900 border border-slate-800 rounded p-3 flex items-end gap-3 text-sm">
          <label className="text-slate-300 flex flex-col gap-1">
            <span className="text-xs text-slate-400">CPA threshold (NM)</span>
            <input
              type="number"
              step="0.1"
              min="0.1"
              value={draftCpaNm}
              onChange={(e) => setDraftCpaNm(Number(e.target.value))}
              className="bg-slate-950 border border-slate-700 rounded px-2 py-1 w-24 font-mono"
            />
          </label>
          <label className="text-slate-300 flex flex-col gap-1">
            <span className="text-xs text-slate-400">TCPA threshold (min)</span>
            <input
              type="number"
              step="1"
              min="1"
              value={draftTcpaMin}
              onChange={(e) => setDraftTcpaMin(Number(e.target.value))}
              className="bg-slate-950 border border-slate-700 rounded px-2 py-1 w-24 font-mono"
            />
          </label>
          <button
            type="button"
            onClick={() => void saveThresholds()}
            className="px-3 py-1 rounded bg-amber-600 text-slate-900 font-medium hover:bg-amber-500"
          >
            Save
          </button>
        </div>
      )}

      <div className="flex gap-4 flex-wrap">
        <div className="relative">
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
              <circle
                cx={center}
                cy={center}
                r={svgRadius}
                fill="none"
                stroke="#475569"
              />
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

              {/* AIS targets */}
              {targetsWithCpa.map(({ target, cpa }) => {
                if (!cpa) return null;
                // Position in the (world-frame) canvas: bearing 0 = up (N).
                const dist = cpa.rangeMeters * metersToPx;
                if (dist > svgRadius) return null;
                const x = center + dist * Math.sin(cpa.bearingRadians);
                const y = center - dist * Math.cos(cpa.bearingRadians);
                const threat = isThreat(cpa);
                const cogDeg = ((target.cog ?? 0) * RAD_TO_DEG) % 360;
                const leaderLen = (target.sog ?? 0) * LEADER_SECONDS * metersToPx;
                return (
                  <g
                    key={target.mmsi}
                    onClick={() => setSelectedMmsi(target.mmsi)}
                    style={{ cursor: 'pointer' }}
                  >
                    <g transform={`translate(${x}, ${y})`}>
                      <g transform={`rotate(${cogDeg})`}>
                        <polygon
                          points="0,-7 -4,5 4,5"
                          fill={threat ? '#ef4444' : '#94a3b8'}
                          stroke="#0f172a"
                          strokeWidth="0.5"
                        />
                        {leaderLen > 1 && (
                          <line
                            x1="0"
                            y1="-7"
                            x2="0"
                            y2={-7 - leaderLen}
                            stroke={threat ? '#ef4444' : '#475569'}
                            strokeWidth="1"
                          />
                        )}
                      </g>
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

              {/* Own boat — at center, pointing along own's heading (compass).
                  In north-up mode that's `ownHeading` degrees clockwise from
                  up; in course-up mode the canvas itself is rotated so the
                  boat triangle always points up. */}
              <g transform={`translate(${center}, ${center}) rotate(${ownHeading * RAD_TO_DEG})`}>
                <polygon
                  points="0,-14 -8,10 8,10"
                  fill="#fbbf24"
                  stroke="#0f172a"
                  strokeWidth="1"
                />
              </g>
            </g>

            {/* North indicator — UNrotated; arrow points to where north is on
                the canvas. In north-up it's straight up; in course-up it points
                back relative to own's heading. */}
            <g transform={`translate(30, 30)`}>
              <circle r="18" fill="#0f172a" stroke="#334155" />
              <g transform={`rotate(${canvasRotationDeg})`}>
                <polygon
                  points="0,-12 -4,4 0,1 4,4"
                  fill="#fbbf24"
                  stroke="#0f172a"
                  strokeWidth="0.5"
                />
              </g>
              <text
                x="0"
                y="-22"
                textAnchor="middle"
                fontSize="10"
                fill="#94a3b8"
                fontFamily="monospace"
              >
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

          {!ownPos && (
            <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
              <div className="bg-slate-900/90 border border-slate-700 rounded px-4 py-2 text-xs text-slate-300 font-mono">
                Waiting for nav.gps.position…
              </div>
            </div>
          )}
        </div>

        <div className="flex-1 min-w-[320px]">
          <h2 className="font-semibold mb-2 text-slate-300">
            Targets ({targetsWithCpa.length})
          </h2>
          {selectedRow && (
            <div className="mb-3 bg-slate-900 border border-slate-800 rounded p-3 text-xs font-mono">
              <div className="text-slate-400 mb-1 text-[10px] uppercase">Selected</div>
              <div className="grid grid-cols-2 gap-y-1">
                <div className="text-slate-400">MMSI</div>
                <div>{selectedRow.target.mmsi}</div>
                <div className="text-slate-400">Name</div>
                <div>{selectedRow.target.name ?? '—'}</div>
                <div className="text-slate-400">Class</div>
                <div>{selectedRow.target.vesselClass}</div>
                <div className="text-slate-400">COG</div>
                <div>
                  {selectedRow.target.cog !== undefined
                    ? `${((selectedRow.target.cog * RAD_TO_DEG + 360) % 360).toFixed(0)}°`
                    : '—'}
                </div>
                <div className="text-slate-400">SOG</div>
                <div>
                  {selectedRow.target.sog !== undefined
                    ? `${(selectedRow.target.sog * MS_TO_KN).toFixed(1)} kn`
                    : '—'}
                </div>
                <div className="text-slate-400">Range</div>
                <div>
                  {selectedRow.cpa
                    ? `${(selectedRow.cpa.rangeMeters / NM).toFixed(2)} NM`
                    : '—'}
                </div>
                <div className="text-slate-400">CPA</div>
                <div>
                  {selectedRow.cpa
                    ? `${(selectedRow.cpa.cpaMeters / NM).toFixed(2)} NM`
                    : '—'}
                </div>
                <div className="text-slate-400">TCPA</div>
                <div>{selectedRow.cpa ? fmtTcpa(selectedRow.cpa.tcpaSeconds) : '—'}</div>
              </div>
            </div>
          )}
          <table className="w-full text-xs font-mono">
            <thead>
              <tr className="text-slate-400 border-b border-slate-800">
                <th className="text-left py-1">MMSI</th>
                <th className="text-left py-1">Name</th>
                <th className="text-right py-1">Range</th>
                <th className="text-right py-1">CPA</th>
                <th className="text-right py-1">TCPA</th>
              </tr>
            </thead>
            <tbody>
              {targetsWithCpa
                .filter(({ cpa }) => cpa && cpa.rangeMeters < rangeNm * NM * 2)
                .sort((a, b) => {
                  // Threats first, then by CPA ascending.
                  const ta = isThreat(a.cpa) ? 0 : 1;
                  const tb = isThreat(b.cpa) ? 0 : 1;
                  if (ta !== tb) return ta - tb;
                  return (a.cpa?.cpaMeters ?? Infinity) - (b.cpa?.cpaMeters ?? Infinity);
                })
                .map(({ target, cpa }) => {
                  const threat = isThreat(cpa);
                  const selected = selectedMmsi === target.mmsi;
                  return (
                    <tr
                      key={target.mmsi}
                      className={`border-b border-slate-900 cursor-pointer hover:bg-slate-900 ${
                        selected ? 'bg-slate-800' : ''
                      } ${threat ? 'text-red-300' : ''}`}
                      onClick={() => setSelectedMmsi(target.mmsi)}
                    >
                      <td className="py-1">{target.mmsi}</td>
                      <td className="py-1">{target.name ?? '—'}</td>
                      <td className="py-1 text-right">
                        {cpa ? `${(cpa.rangeMeters / NM).toFixed(2)}` : '—'}
                      </td>
                      <td className="py-1 text-right">
                        {cpa ? `${(cpa.cpaMeters / NM).toFixed(2)}` : '—'}
                      </td>
                      <td className="py-1 text-right">{cpa ? fmtTcpa(cpa.tcpaSeconds) : '—'}</td>
                    </tr>
                  );
                })}
            </tbody>
          </table>
        </div>
      </div>
    </main>
  );
}
