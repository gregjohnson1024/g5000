'use client';

import { type Dispatch, type SetStateAction } from 'react';
import { hrrrHorizonHours, pickHrrrRun } from '../../lib/hrrr-helpers';
import { fmtHourLabel, type TzMode } from '../../lib/tz';

// Full intended forecast set: GFS is hourly to +120 h then 3-hourly to +168 h.
// Matches the refresh job, so the timeline can show how far the cache has
// filled (available vs in-progress).
const WIND_FORECAST_HOURS: number[] = [
  ...Array.from({ length: 121 }, (_, i) => i),
  ...Array.from({ length: 16 }, (_, i) => 123 + i * 3),
];

interface WindTimelineProps {
  availableHours: {
    gfs: number[];
    ecmwf: number[];
    hrrr: number[];
  };
  latestRunAt: {
    gfs: number | null;
    ecmwf: number | null;
    hrrr: number | null;
  };
  windHours: number;
  windLockNow: boolean;
  tz: TzMode;
  model: 'gfs' | 'ecmwf' | 'hrrr' | null;
  setWindHours: Dispatch<SetStateAction<number>>;
  setWindLockNow: Dispatch<SetStateAction<boolean>>;
}

/**
 * Wind-forecast timeline (run, valid time, hour stepper). Only
 * shown when a wind model (GFS/ECMWF) is active — CMEMS is a
 * daily mean without an hour-stepped slider.
 */
export function WindTimeline({
  availableHours,
  latestRunAt,
  windHours,
  windLockNow,
  tz,
  model,
  setWindHours,
  setWindLockNow,
}: WindTimelineProps) {
  const fullList = availableHours[model ?? 'gfs'];
  const activeWindModel = model ?? 'gfs';
  if (fullList.length === 0) {
    return (
      <div className="text-xs text-amber-300">
        No {activeWindModel.toUpperCase()} forecast cached. Visit{' '}
        <a href="/forecast" className="underline">
          Forecast
        </a>
        .
      </div>
    );
  }
  // Filter out forecast hours whose valid time is in the past.
  // Slider always starts at "now" (or the first cached hour
  // that's still useful). Falls back to the full list if we
  // don't yet know the run time.
  const runAt = latestRunAt[activeWindModel];
  const nowS = Date.now() / 1000;
  const list = runAt
    ? fullList.filter((h) => runAt + h * 3600 >= nowS - 1800) // 30 min grace
    : fullList;
  if (list.length === 0) {
    return (
      <div className="text-xs text-amber-300">
        {activeWindModel.toUpperCase()} forecast cache is stale (all valid times in the past).
        Refresh on{' '}
        <a href="/forecast" className="underline">
          Forecast
        </a>
        .
      </div>
    );
  }
  // The hour whose valid time is closest to now (used when locked).
  // With runAt unknown, list[0] is the earliest still-valid hour.
  const nearestNowIdx = (): number => {
    if (!runAt) return 0;
    let best = 0;
    let bestDiff = Infinity;
    for (let i = 0; i < list.length; i++) {
      const d = Math.abs(runAt + list[i]! * 3600 - nowS);
      if (d < bestDiff) {
        bestDiff = d;
        best = i;
      }
    }
    return best;
  };
  const idx = list.indexOf(windHours);
  // Locked → track the nearest-now hour (advances as the clock moves
  // and fresh hours land); unlocked → keep the user's chosen hour.
  const effectiveIdx = windLockNow ? nearestNowIdx() : idx >= 0 ? idx : 0;
  const effectiveHours = list[effectiveIdx]!;
  if (effectiveHours !== windHours) {
    setTimeout(() => setWindHours(effectiveHours), 0);
  }
  // ←/→ are explicit hour navigation, so they exit lock mode.
  const goPrev = (): void => {
    if (effectiveIdx > 0) {
      setWindLockNow(false);
      setWindHours(list[effectiveIdx - 1]!);
    }
  };
  const goNext = (): void => {
    if (effectiveIdx < list.length - 1) {
      setWindLockNow(false);
      setWindHours(list[effectiveIdx + 1]!);
    }
  };
  // Label: "HH:MM[Z] DD MMM (in N h)" — absolute time in the
  // page's current Local/UTC mode, plus a relative offset so
  // it's clear where we are on the timeline.
  let label = `+${effectiveHours}h`;
  if (runAt) {
    const validUnix = runAt + effectiveHours * 3600;
    const absLabel = fmtHourLabel(validUnix, tz);
    const hoursFromNow = (validUnix - nowS) / 3600;
    const rel =
      Math.abs(hoursFromNow) < 0.5
        ? 'now'
        : hoursFromNow < 0
          ? `${Math.round(-hoursFromNow)}h ago`
          : `in ${Math.round(hoursFromNow)}h`;
    label = `${absLabel} (${rel})`;
  }
  return (
    <div className="space-y-1">
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => setWindLockNow((v) => !v)}
          aria-pressed={windLockNow}
          className={`px-2 py-0.5 text-xs rounded ${
            windLockNow ? 'bg-sky-600 text-white' : 'bg-slate-700 text-slate-300 hover:bg-slate-600'
          }`}
          title={
            windLockNow
              ? 'Locked to current time — click to unlock and scrub'
              : 'Lock the slider to current time'
          }
        >
          now
        </button>
        <button
          type="button"
          onClick={goPrev}
          disabled={effectiveIdx <= 0}
          className="px-2 py-0.5 text-xs bg-slate-700 hover:bg-slate-600 rounded disabled:opacity-30"
          title="Previous cached hour"
        >
          ←
        </button>
        <span className="text-xs text-slate-400 font-mono flex-1 text-center">{label}</span>
        <button
          type="button"
          onClick={goNext}
          disabled={effectiveIdx >= list.length - 1}
          className="px-2 py-0.5 text-xs bg-slate-700 hover:bg-slate-600 rounded disabled:opacity-30"
          title="Next cached hour"
        >
          →
        </button>
      </div>
      {(() => {
        // Slider spans the full intended range (to +168 h, past
        // hours dropped) so a two-band track can show how far the
        // cache has filled: darker = available (cached), lighter =
        // still in progress. The thumb still snaps to cached hours.
        const minH = list[0]!;
        const availMaxH = list[list.length - 1]!;
        // HRRR is short-horizon (≤18 h, or ≤48 h on synoptic runs),
        // far shorter than GFS/ECMWF's 168 h — clamp the intended
        // range so the slider doesn't render a long empty band.
        const intendedHours =
          activeWindModel === 'hrrr'
            ? WIND_FORECAST_HOURS.filter((h) => h <= hrrrHorizonHours(pickHrrrRun(nowS).runHourUtc))
            : WIND_FORECAST_HOURS;
        const expectedMaxH = Math.max(
          availMaxH,
          ...intendedHours.filter((h) => !runAt || runAt + h * 3600 >= nowS - 1800),
        );
        const span = expectedMaxH - minH;
        const availPct = span > 0 ? ((availMaxH - minH) / span) * 100 : 100;
        return (
          <div className="relative w-full">
            {/* Two-band track behind the slider: lighter = still
                in progress, darker = available (cached). */}
            <div className="absolute inset-x-0 top-1/2 -translate-y-1/2 h-1.5 rounded-full overflow-hidden bg-sky-300/40">
              <div
                className="absolute inset-y-0 left-0 bg-sky-600"
                style={{ width: `${availPct}%` }}
                title="Available (cached); the lighter band is still being fetched"
              />
            </div>
            <input
              type="range"
              min={minH}
              max={expectedMaxH}
              step={1}
              value={effectiveHours}
              onChange={(e) => {
                const v = Number(e.target.value);
                const nearest = list.reduce(
                  (best, h) => (Math.abs(h - v) < Math.abs(best - v) ? h : best),
                  list[0]!,
                );
                setWindLockNow(false); // scrubbing exits lock mode
                setWindHours(nearest);
              }}
              className="fc-slider relative block w-full"
            />
          </div>
        );
      })()}
    </div>
  );
}
