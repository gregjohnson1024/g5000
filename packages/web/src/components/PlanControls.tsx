'use client';
import { useEffect, useState } from 'react';
import {
  fmtTimestamp,
  parseDatetimeLocalInput,
  toDatetimeLocalInput,
  type TzMode,
} from '../lib/tz';

export interface PlanRequest {
  start: { lat: number; lon: number };
  end: { lat: number; lon: number };
  departure: number;
  model: 'GFS' | 'ECMWF';
  polarId: string;
  polar: unknown;
  useCurrents?: boolean;
  options?: Record<string, unknown>;
}

const MOTOR_KEY = 'chart:motorMode';
const KNOTS_TO_MS = 0.514444;

export function PlanControls(props: {
  start?: { lat: number; lon: number };
  end?: { lat: number; lon: number };
  onPlan: (req: PlanRequest) => void;
  loading: boolean;
  /** Page-level timezone display preference. Controls how the Departure
   *  picker labels itself and how its input string is interpreted. */
  tz: TzMode;
}) {
  const tz = props.tz;
  const [model, setModel] = useState<'GFS' | 'ECMWF'>('GFS');
  // Departure is stored as an absolute UNIX-seconds anchor; the displayed
  // string is derived from anchor + tz, so flipping the toggle preserves
  // the moment in time rather than the wallclock typed.
  const [departureAnchor, setDepartureAnchor] = useState<number>(() => Date.now() / 1000 + 3600);
  const departureInput = toDatetimeLocalInput(departureAnchor, tz);
  const [useCurrents, setUseCurrents] = useState<boolean>(false);
  // Motor mode + cruise speed (knots). Persisted to localStorage so the
  // user's mode choice survives page reloads. Defaults to motor=true at
  // 5 kn — Sula is on a motor-only passage. Sailors will uncheck.
  const [motor, setMotor] = useState<boolean>(true);
  const [motorKt, setMotorKt] = useState<number>(5);
  const [motorRestored, setMotorRestored] = useState<boolean>(false);
  useEffect(() => {
    try {
      const raw = localStorage.getItem(MOTOR_KEY);
      if (raw) {
        const j = JSON.parse(raw) as { motor?: boolean; motorKt?: number };
        if (typeof j.motor === 'boolean') setMotor(j.motor);
        if (typeof j.motorKt === 'number' && j.motorKt > 0) setMotorKt(j.motorKt);
      }
    } catch {
      /* corrupt — keep defaults */
    }
    setMotorRestored(true);
  }, []);
  useEffect(() => {
    if (!motorRestored) return;
    try {
      localStorage.setItem(MOTOR_KEY, JSON.stringify({ motor, motorKt }));
    } catch {
      /* quota or disabled */
    }
  }, [motor, motorKt, motorRestored]);
  const onSubmit = async () => {
    const polarRes = await fetch('/api/wardrobe/active');
    if (!polarRes.ok) return alert('No polar available (live or cached).');
    const { polar } = await polarRes.json();
    const t = Math.floor(departureAnchor);
    if (!props.start || !props.end) return alert('Click start and end on the map first.');
    props.onPlan({
      start: props.start,
      end: props.end,
      departure: t,
      model,
      polarId: polar.id ?? 'default',
      polar: polar.polar ?? polar,
      useCurrents,
      // Always capture isochrones — the chart draws them as a fan-out
      // visualisation behind the route polyline so the user can see the
      // exploration depth at each step.
      options: {
        captureIsochrones: true,
        motor,
        motorSpeed: motorKt * KNOTS_TO_MS,
      },
    });
  };
  return (
    <div className="space-y-2">
      <label className="block text-sm">
        Departure ({tz === 'utc' ? 'UTC' : 'local'})
        <input
          type="datetime-local"
          value={departureInput}
          onChange={(e) => setDepartureAnchor(parseDatetimeLocalInput(e.target.value, tz))}
          className="bg-slate-900 border border-slate-700 rounded px-2 py-1 w-full"
        />
        <span className="text-[10px] text-slate-500 font-mono">
          ≡ {fmtTimestamp(departureAnchor, tz === 'utc' ? 'local' : 'utc')}
        </span>
      </label>
      <label className="block text-sm">
        Wind model
        <select
          value={model}
          onChange={(e) => setModel(e.target.value as 'GFS' | 'ECMWF')}
          className="bg-slate-900 border border-slate-700 rounded px-2 py-1 w-full"
        >
          <option value="GFS">GFS (NOAA)</option>
          <option value="ECMWF">ECMWF</option>
        </select>
      </label>
      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={useCurrents}
          onChange={(e) => setUseCurrents(e.target.checked)}
          className="bg-slate-900 border border-slate-700 rounded"
        />
        Use surface currents (RTOFS)
      </label>
      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={motor}
          onChange={(e) => setMotor(e.target.checked)}
          className="bg-slate-900 border border-slate-700 rounded"
        />
        Motor (ignore polar, use fixed speed)
      </label>
      {motor && (
        <label className="block text-sm pl-6">
          Motor speed
          <div className="flex items-center gap-1">
            <input
              type="number"
              min={0.5}
              max={30}
              step={0.1}
              value={motorKt}
              onChange={(e) => setMotorKt(Number(e.target.value) || 0)}
              className="bg-slate-900 border border-slate-700 rounded px-2 py-1 w-20"
            />
            <span className="text-slate-400">kn</span>
          </div>
        </label>
      )}
      <button
        disabled={props.loading || !props.start || !props.end}
        onClick={onSubmit}
        className="bg-emerald-700 disabled:bg-slate-700 px-3 py-2 rounded w-full text-sm"
      >
        {props.loading ? 'Planning…' : 'Plan'}
      </button>
    </div>
  );
}
