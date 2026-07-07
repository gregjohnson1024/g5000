'use client';

import { useEffect, useRef, useState } from 'react';
import type { JsonSafeSample } from '@g5000/core';
import { haversineM, bearingDeg } from '../../../lib/geo';
import { computeScope } from '../../../lib/rode-scope';
import { Panel } from '../../../components/ui/Panel';
import { StatusChip } from '../../../components/ui/StatusChip';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface AnchorState {
  armed: boolean;
  point?: { lat: number; lon: number };
  anchorPoint?: { lat: number; lon: number };
  radiusM: number;
  coneDeg?: number;
  coneCenterDeg?: number;
}

interface PollResult {
  ok: boolean;
  anchor: AnchorState;
  breached: boolean;
  alarm: unknown;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function scalar(s: JsonSafeSample | undefined): number | null {
  if (!s || s.value.kind !== 'scalar') return null;
  return s.value.value;
}

function geo(s: JsonSafeSample | undefined): { lat: number; lon: number } | null {
  if (!s || s.value.kind !== 'geo') return null;
  return s.value.value;
}

// ---------------------------------------------------------------------------
// Mini SVG plan-view
// ---------------------------------------------------------------------------

const SVG_SIZE = 160; // px, square
const PADDING = 16; // px inside the circle ring

interface PlanViewProps {
  anchorPoint: { lat: number; lon: number };
  boatPos: { lat: number; lon: number };
  radiusM: number;
  breached: boolean;
}

function PlanView({ anchorPoint, boatPos, radiusM, breached }: PlanViewProps): React.ReactElement {
  const cx = SVG_SIZE / 2;
  const cy = SVG_SIZE / 2;
  const circleR = SVG_SIZE / 2 - PADDING;

  // Scale: circleR px = radiusM metres
  const scale = circleR / Math.max(radiusM, 1);

  // Boat position relative to anchor in metres (north-up)
  const dLat = (boatPos.lat - anchorPoint.lat) * (Math.PI / 180) * 6_371_008.8;
  const dLon =
    (boatPos.lon - anchorPoint.lon) *
    (Math.PI / 180) *
    6_371_008.8 *
    Math.cos((anchorPoint.lat * Math.PI) / 180);

  // SVG: +x = east, +y = south (flip dLat)
  const bxRaw = cx + dLon * scale;
  const byRaw = cy - dLat * scale;

  // Clamp boat dot inside the SVG
  const clampedDist = Math.sqrt(dLon ** 2 + dLat ** 2) * scale;
  let bx: number;
  let by: number;
  if (clampedDist > circleR) {
    const angle = Math.atan2(byRaw - cy, bxRaw - cx);
    bx = cx + Math.cos(angle) * circleR;
    by = cy + Math.sin(angle) * circleR;
  } else {
    bx = bxRaw;
    by = byRaw;
  }

  // Use token hex equivalents; SVG can't use CSS custom properties in fill/stroke
  // breached: danger (#f87171 day), armed ring: info (#38bdf8 day)
  const ringColor = breached ? '#f87171' : '#38bdf8';
  const fillColor = breached ? 'rgba(248,113,113,0.12)' : 'rgba(56,189,248,0.08)';

  return (
    <svg width={SVG_SIZE} height={SVG_SIZE} viewBox={`0 0 ${SVG_SIZE} ${SVG_SIZE}`}>
      {/* Drag circle */}
      <circle cx={cx} cy={cy} r={circleR} fill={fillColor} stroke={ringColor} strokeWidth={1.5} />
      {/* N tick */}
      <line x1={cx} y1={PADDING - 4} x2={cx} y2={PADDING + 4} stroke="#475569" strokeWidth={1} />
      <text x={cx} y={PADDING - 6} fill="#475569" fontSize={8} textAnchor="middle">
        N
      </text>
      {/* Rode line */}
      <line
        x1={cx}
        y1={cy}
        x2={bx}
        y2={by}
        stroke="#64748b"
        strokeWidth={1.5}
        strokeDasharray="3 2"
      />
      {/* Anchor marker (cross + circle) */}
      <circle cx={cx} cy={cy} r={5} fill="#0f172a" stroke="#38bdf8" strokeWidth={1.5} />
      <text x={cx} y={cy - 8} fill="#38bdf8" fontSize={7} textAnchor="middle">
        ⚓
      </text>
      {/* Boat dot */}
      <circle cx={bx} cy={by} r={4} fill={breached ? '#f87171' : '#f1f5f9'} />
    </svg>
  );
}

// ---------------------------------------------------------------------------
// Rode & Scope calculator (sub-component, embedded in same file)
// ---------------------------------------------------------------------------

interface RodeScopeCalcProps {
  channels: ReadonlyMap<string, JsonSafeSample>;
  droopDeduct?: number;
  bowHeightM?: number;
}

function RodeScopeCalc({
  channels,
  droopDeduct = 0,
  bowHeightM = 0,
}: RodeScopeCalcProps): React.ReactElement {
  const depthM = scalar(channels.get('nav.depth'));

  // chainCounter: persisted in localStorage, SSR-safe (read in effect)
  const [chainCounter, setChainCounter] = useState<number>(0);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    const stored = localStorage.getItem('anchor:chainCounter');
    if (stored !== null) {
      const n = parseFloat(stored);
      if (!Number.isNaN(n)) setChainCounter(n);
    }
    setLoaded(true);
  }, []);

  function handleChainChange(e: React.ChangeEvent<HTMLInputElement>): void {
    const v = parseFloat(e.target.value);
    const clamped = Number.isNaN(v) ? 0 : Math.max(0, v);
    setChainCounter(clamped);
    localStorage.setItem('anchor:chainCounter', String(clamped));
  }

  const result =
    loaded && depthM !== null
      ? computeScope({ chainCounter, droopDeduct, depthM, bowHeightM })
      : null;

  return (
    <div className="border-t border-hairline mt-3 pt-3 flex flex-col gap-2">
      <span className="text-[0.667rem] font-semibold uppercase tracking-[0.08em] text-ink-2">
        Rode &amp; Scope
      </span>

      {/* Chain counter input */}
      <div className="flex items-center gap-2">
        <label className="text-xs text-ink-3 w-24">Chain out (m)</label>
        <input
          type="number"
          min={0}
          step={1}
          value={loaded ? chainCounter : ''}
          onChange={handleChainChange}
          className="w-20 bg-surface-raised border border-hairline-strong rounded px-2 py-0.5 text-sm text-ink-value text-right focus:outline-none focus:border-accent-hi"
        />
      </div>

      {/* Results */}
      {result !== null ? (
        <div className="grid grid-cols-3 gap-2">
          <div className="flex flex-col items-center">
            <span className="text-lg font-bold text-ink-value">
              {result.rode.toFixed(0)}
              <span className="text-xs text-ink-3 ml-0.5">m</span>
            </span>
            <span className="text-[0.611rem] text-ink-3 uppercase tracking-wide">Rode</span>
          </div>
          <div className="flex flex-col items-center">
            <span className="text-lg font-bold text-ink-value">
              {result.totalPlusBow.toFixed(1)}
              <span className="text-xs text-ink-3 ml-0.5">m</span>
            </span>
            <span className="text-[0.611rem] text-ink-3 uppercase tracking-wide">Depth+Bow</span>
          </div>
          <div className="flex flex-col items-center">
            <span className="text-lg font-bold text-ink-value">
              {result.scope !== null ? result.scope.toFixed(1) : '—'}
              <span className="text-xs text-ink-3 ml-0.5">:1</span>
            </span>
            <span className="text-[0.611rem] text-ink-3 uppercase tracking-wide">Scope</span>
          </div>
        </div>
      ) : (
        <span className="text-ink-4 text-xs italic">
          {depthM === null ? 'No depth data' : 'Loading…'}
        </span>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// AnchorWatchPanel
// ---------------------------------------------------------------------------

export interface AnchorWatchPanelProps {
  channels: ReadonlyMap<string, JsonSafeSample>;
  /** Boat-constant droop deduction (m). Task 21 wires real value; default 0. */
  droopDeduct?: number;
  /** Bow height above water (m). Task 21 wires real value; default 0. */
  bowHeightM?: number;
}

export function AnchorWatchPanel({
  channels,
  droopDeduct = 0,
  bowHeightM = 0,
}: AnchorWatchPanelProps): React.ReactElement {
  const [pollResult, setPollResult] = useState<PollResult | null>(null);
  const [radiusInput, setRadiusInput] = useState<number>(50);
  const [posting, setPosting] = useState(false);
  const stoppedRef = useRef(false);

  // 2-second poll — mirrors AnchorWatchLayer.tsx
  useEffect(() => {
    stoppedRef.current = false;
    async function poll(): Promise<void> {
      try {
        const r = await fetch('/api/alarms/anchor', { cache: 'no-store' });
        if (stoppedRef.current) return;
        const body = (await r.json()) as PollResult;
        if (body.ok) {
          setPollResult(body);
          // Only sync radiusInput from the server when ARMED — preserves the
          // user's typed value while they're in the disarmed "set drop radius" state.
          if (body.anchor?.armed && body.anchor.radiusM) setRadiusInput(body.anchor.radiusM);
        }
      } catch {
        // transient network error — keep going
      }
    }
    poll();
    const t = setInterval(poll, 2000);
    return () => {
      stoppedRef.current = true;
      clearInterval(t);
    };
  }, []);

  const boatPos = geo(channels.get('nav.gps.position'));
  const anchor = pollResult?.anchor;
  const armed = anchor?.armed === true;
  const breached = pollResult?.breached === true;
  const anchorPoint = anchor?.anchorPoint ?? anchor?.point;

  // Derived distance/bearing (metres / degrees true) using geo.ts helpers
  let distM: number | null = null;
  let bearingT: number | null = null;
  if (armed && anchorPoint && boatPos) {
    distM = haversineM(boatPos.lat, boatPos.lon, anchorPoint.lat, anchorPoint.lon);
    bearingT = bearingDeg(boatPos, anchorPoint);
  }

  async function handleDrop(): Promise<void> {
    if (!boatPos) return;
    setPosting(true);
    try {
      await fetch('/api/alarms/anchor', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'drop',
          position: { lat: boatPos.lat, lon: boatPos.lon },
          radiusM: radiusInput,
        }),
      });
    } finally {
      setPosting(false);
    }
  }

  async function handleWeigh(): Promise<void> {
    setPosting(true);
    try {
      await fetch('/api/alarms/anchor', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'weigh' }),
      });
    } finally {
      setPosting(false);
    }
  }

  // StatusChip kind: armed = 'armed' (pulse), disarmed = 'neutral'
  const chipKind = armed ? (breached ? 'alarm' : 'armed') : 'neutral';
  const chipLabel = armed ? (breached ? 'DRAG' : 'ARMED') : 'DISARMED';

  return (
    <Panel label="Anchor Watch" chip={chipKind} chipLabel={chipLabel} className="col-span-2">
      {armed && anchorPoint && boatPos ? (
        // ── ARMED STATE ──────────────────────────────────────────────────────
        <>
          {/* Stats row */}
          <div className="grid grid-cols-3 gap-2 mb-2">
            <div className="flex flex-col items-center">
              <span className={`text-2xl font-bold ${breached ? 'text-danger' : 'text-ink-value'}`}>
                {distM !== null ? Math.round(distM) : '—'}
                <span className="text-xs text-ink-3 ml-0.5">m</span>
              </span>
              <span className="text-[0.611rem] text-ink-3 uppercase tracking-wide">Distance</span>
            </div>
            <div className="flex flex-col items-center">
              <span className="text-2xl font-bold text-ink-value">
                {bearingT !== null ? Math.round(bearingT) : '—'}
                <span className="text-xs text-ink-3 ml-0.5">°T</span>
              </span>
              <span className="text-[0.611rem] text-ink-3 uppercase tracking-wide">Bearing</span>
            </div>
            <div className="flex flex-col items-center">
              <span className="text-2xl font-bold text-ink-value">
                {anchor?.radiusM ?? '—'}
                <span className="text-xs text-ink-3 ml-0.5">m</span>
              </span>
              <span className="text-[0.611rem] text-ink-3 uppercase tracking-wide">Radius</span>
            </div>
          </div>

          {/* Mini plan-view */}
          <div className="flex justify-center">
            <PlanView
              anchorPoint={anchorPoint}
              boatPos={boatPos}
              radiusM={anchor?.radiusM ?? 50}
              breached={breached}
            />
          </div>

          {breached && (
            <div className="text-xs text-danger text-center font-semibold animate-pulse mt-1">
              ANCHOR DRAG ALERT
            </div>
          )}

          {/* Clear (weigh) control */}
          <button
            onClick={handleWeigh}
            disabled={posting}
            className="mt-2 w-full rounded bg-surface-raised hover:bg-hairline-strong text-ink text-sm py-1.5 disabled:opacity-50"
          >
            Clear (Weigh Anchor)
          </button>
        </>
      ) : (
        // ── NOT ARMED STATE ───────────────────────────────────────────────────
        <div className="flex flex-col gap-2">
          <div className="flex items-center gap-2">
            <label className="text-xs text-ink-3 w-24">Radius (m)</label>
            <input
              type="number"
              min={10}
              step={5}
              value={radiusInput}
              onChange={(e) => setRadiusInput(Math.max(10, parseFloat(e.target.value) || 50))}
              className="w-20 bg-surface-raised border border-hairline-strong rounded px-2 py-0.5 text-sm text-ink-value text-right focus:outline-none focus:border-accent-hi"
            />
          </div>
          {boatPos ? (
            <button
              onClick={handleDrop}
              disabled={posting}
              className="w-full rounded bg-info/20 border border-info text-ink-value hover:bg-info/30 text-sm py-1.5 font-semibold disabled:opacity-50"
            >
              Drop here (use GPS)
            </button>
          ) : (
            <div className="text-xs text-ink-4 italic text-center">Waiting for GPS fix…</div>
          )}
        </div>
      )}

      {/* Rode & Scope calculator always shown */}
      <RodeScopeCalc channels={channels} droopDeduct={droopDeduct} bowHeightM={bowHeightM} />
    </Panel>
  );
}
