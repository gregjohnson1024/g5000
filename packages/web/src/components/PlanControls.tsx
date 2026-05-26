'use client';
import { useEffect, useState } from 'react';
import {
  fmtTimestamp,
  parseDatetimeLocalInput,
  toDatetimeLocalInput,
  type TzMode,
} from '../lib/tz';

export interface PlanParams {
  start: { lat: number; lon: number };
  end: { lat: number; lon: number };
  departure: number;
  models: Array<'GFS' | 'ECMWF'>;
  useCurrents: boolean;
  options: {
    avoidLand?: boolean;
    pruneBucketDeg?: number;
    stepMinutes?: number;
    maxHours?: number;
    autoMotor?: { minSail: number; motor: number };
  };
}

const KN = 0.514444;

const inputClass = 'bg-slate-900 border border-slate-700 rounded px-2 py-1';
const checkboxClass = 'bg-slate-900 border border-slate-700 rounded';

/** Number input that coerces blanks/NaN to 0, matching the planner's tolerance
 *  for empty fields. `width` picks the inline (kn boxes) vs full-width variant. */
function NumberInput(props: {
  value: number;
  min: number;
  step: number;
  onChange: (value: number) => void;
  width: 'inline' | 'full';
}) {
  return (
    <input
      type="number"
      min={props.min}
      step={props.step}
      value={props.value}
      onChange={(e) => props.onChange(Number(e.target.value) || 0)}
      className={`${inputClass} ${props.width === 'inline' ? 'w-16' : 'w-full'}`}
    />
  );
}

export function PlanControls(props: {
  start?: { lat: number; lon: number };
  end?: { lat: number; lon: number };
  onPlan: (params: PlanParams) => void;
  loading: boolean;
  /** Page-level timezone display preference. Controls how the Departure
   *  picker labels itself and how its input string is interpreted. */
  tz: TzMode;
}) {
  const tz = props.tz;
  // Departure is stored as an absolute UNIX-seconds anchor; the displayed
  // string is derived from anchor + tz, so flipping the toggle preserves
  // the moment in time rather than the wallclock typed.
  const [departureAnchor, setDepartureAnchor] = useState<number>(() => Date.now() / 1000 + 3600);
  const departureInput = toDatetimeLocalInput(departureAnchor, tz);
  const [useCurrents, setUseCurrents] = useState<boolean>(false);
  // Wind models to plan against — both on by default so a single Plan press
  // fans out a GFS and an ECMWF route for side-by-side comparison.
  const [models, setModels] = useState({ gfs: true, ecmwf: true });
  // Auto-motor: motor when the polar speed drops below minSail, capping the
  // engine contribution at motorKt. Seeded from saved Settings/Planning prefs.
  const [auto, setAuto] = useState({ enabled: false, minSailKt: 3, motorKt: 5 });
  // Advanced isochrone-router knobs, also seeded from settings.
  const [adv, setAdv] = useState({
    avoidLand: true,
    pruneBucketDeg: 2,
    stepMinutes: 30,
    maxHours: 168,
  });

  useEffect(() => {
    void fetch('/api/settings')
      .then((r) => r.json())
      .then((j) => {
        const pl = j?.settings?.planning;
        if (pl) {
          if (pl.autoMotor)
            setAuto({
              enabled: !!pl.autoMotor.enabled,
              minSailKt: pl.autoMotor.minSailKt ?? 3,
              motorKt: pl.autoMotor.motorKt ?? 5,
            });
          setAdv((a) => ({
            ...a,
            avoidLand: pl.avoidLand ?? a.avoidLand,
            pruneBucketDeg: pl.pruneBucketDeg ?? a.pruneBucketDeg,
            stepMinutes: pl.stepMinutes ?? a.stepMinutes,
            maxHours: pl.maxHours ?? a.maxHours,
          }));
        }
      })
      .catch(() => {});
  }, []);

  const onSubmit = () => {
    const selected = [models.gfs && 'GFS', models.ecmwf && 'ECMWF'].filter(Boolean) as Array<
      'GFS' | 'ECMWF'
    >;
    if (!props.start || !props.end || selected.length === 0) return;
    props.onPlan({
      start: props.start,
      end: props.end,
      departure: Math.floor(departureAnchor),
      models: selected,
      useCurrents,
      options: {
        avoidLand: adv.avoidLand,
        pruneBucketDeg: adv.pruneBucketDeg,
        stepMinutes: adv.stepMinutes,
        maxHours: adv.maxHours,
        autoMotor: auto.enabled
          ? { minSail: auto.minSailKt * KN, motor: auto.motorKt * KN }
          : undefined,
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
          className={`${inputClass} w-full`}
        />
        <span className="text-[10px] text-slate-500 font-mono">
          ≡ {fmtTimestamp(departureAnchor, tz === 'utc' ? 'local' : 'utc')}
        </span>
      </label>
      <fieldset className="block text-sm">
        <legend>Wind models</legend>
        <div className="flex items-center gap-4">
          {(['gfs', 'ecmwf'] as const).map((key) => (
            <label key={key} className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={models[key]}
                onChange={(e) => setModels((m) => ({ ...m, [key]: e.target.checked }))}
                className={checkboxClass}
              />
              {key === 'gfs' ? 'GFS' : 'ECMWF'}
            </label>
          ))}
        </div>
      </fieldset>
      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={useCurrents}
          onChange={(e) => setUseCurrents(e.target.checked)}
          className={checkboxClass}
        />
        Use surface currents (RTOFS)
      </label>
      <div className="space-y-1 text-sm">
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={auto.enabled}
            onChange={(e) => setAuto((a) => ({ ...a, enabled: e.target.checked }))}
            className={checkboxClass}
          />
          Auto-motor
        </label>
        {auto.enabled && (
          <div className="flex flex-wrap items-center gap-1 pl-6 text-xs text-slate-400">
            motor when slower than
            <NumberInput
              min={0}
              step={0.5}
              value={auto.minSailKt}
              onChange={(minSailKt) => setAuto((a) => ({ ...a, minSailKt }))}
              width="inline"
            />
            kn, at
            <NumberInput
              min={0}
              step={0.5}
              value={auto.motorKt}
              onChange={(motorKt) => setAuto((a) => ({ ...a, motorKt }))}
              width="inline"
            />
            kn
          </div>
        )}
      </div>
      <details className="text-sm">
        <summary className="cursor-pointer text-slate-300">Advanced</summary>
        <div className="space-y-2 pt-2">
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={adv.avoidLand}
              onChange={(e) => setAdv((a) => ({ ...a, avoidLand: e.target.checked }))}
              className={checkboxClass}
            />
            Avoid land
          </label>
          <label className="block">
            Frontier size (°)
            <NumberInput
              min={0.5}
              step={0.5}
              value={adv.pruneBucketDeg}
              onChange={(pruneBucketDeg) => setAdv((a) => ({ ...a, pruneBucketDeg }))}
              width="full"
            />
          </label>
          <label className="block">
            Isochrone length (min)
            <NumberInput
              min={5}
              step={5}
              value={adv.stepMinutes}
              onChange={(stepMinutes) => setAdv((a) => ({ ...a, stepMinutes }))}
              width="full"
            />
          </label>
          <label className="block">
            Max hours
            <NumberInput
              min={12}
              step={12}
              value={adv.maxHours}
              onChange={(maxHours) => setAdv((a) => ({ ...a, maxHours }))}
              width="full"
            />
          </label>
        </div>
      </details>
      <button
        disabled={props.loading || !props.start || !props.end || (!models.gfs && !models.ecmwf)}
        onClick={onSubmit}
        className="bg-emerald-700 disabled:bg-slate-700 px-3 py-2 rounded w-full text-sm"
      >
        {props.loading ? 'Planning…' : 'Plan'}
      </button>
    </div>
  );
}
