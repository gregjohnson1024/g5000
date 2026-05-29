import { pickEcmwfRun } from '@g5000/grib';
import { pickHrrrRun } from './hrrr-helpers';
import type { WindModel } from './wind-fetch';

/**
 * The run (unix seconds) a fetch *now* would target for `model` — deterministic
 * from the clock + each model's publication lag. Lets the refresh skip an hour
 * whose cached grid already has this run (incremental refresh), and lets the
 * UI tell whether a newer run than cached is available.
 */
export function expectedRunUnix(model: WindModel, now: Date = new Date()): number {
  if (model === 'ecmwf') {
    const run = pickEcmwfRun(now.getTime() / 1000);
    return (
      Date.UTC(
        Number(run.runDateUtc.slice(0, 4)),
        Number(run.runDateUtc.slice(5, 7)) - 1,
        Number(run.runDateUtc.slice(8, 10)),
        run.runHourUtc,
      ) / 1000
    );
  }
  if (model === 'hrrr') {
    const run = pickHrrrRun(now.getTime() / 1000);
    return (
      Date.UTC(
        Number(run.runDateUtc.slice(0, 4)),
        Number(run.runDateUtc.slice(5, 7)) - 1,
        Number(run.runDateUtc.slice(8, 10)),
        run.runHourUtc,
      ) / 1000
    );
  }
  return pickRun(now).runUnix;
}

/**
 * Pick the most recently completed GFS 0p25 run for `forecastHour` ahead of
 * `at`. GFS runs at 00/06/12/18 UTC and the run becomes available ~3.5 h
 * after its nominal time.
 */
/** Hours of publication lag after a model's nominal run start. */
export const PUBLICATION_LAG_HOURS: Record<WindModel, number> = {
  gfs: 4,
  // ECMWF's 0.25° open data lands ~7–9 h after run start; keep this in step
  // with pickEcmwfRun's lag in @g5000/grib so `runAvailability` doesn't claim a
  // run is available before the fetcher will actually pull it.
  ecmwf: 9,
  // HRRR runs hourly and posts ~50–90 min after the hour; pickHrrrRun lags 2 h.
  hrrr: 2,
};

/**
 * For a given model and reference time, return the most-recently-available
 * run and the wall-clock time at which the next run becomes available.
 */
export function runAvailability(
  model: WindModel,
  at: Date = new Date(),
): { latestRunUnix: number; nextRunAvailableUnix: number } {
  const lag = PUBLICATION_LAG_HOURS[model];
  if (model === 'hrrr') {
    // HRRR runs every hour, not on the 6-hourly synoptic cycle. Walk back the
    // lag and truncate to the top of that hour.
    const t = new Date(at.getTime() - lag * 3600 * 1000);
    const latestRunUnix =
      Date.UTC(t.getUTCFullYear(), t.getUTCMonth(), t.getUTCDate(), t.getUTCHours()) / 1000;
    const nextRunNominal = latestRunUnix + 3600;
    const nextRunAvailableUnix = nextRunNominal + lag * 3600;
    return { latestRunUnix, nextRunAvailableUnix };
  }
  // Walk back `lag` hours; the run "before" that wall-clock time is the
  // most recent that's been fully published.
  const t = new Date(at.getTime() - lag * 3600 * 1000);
  const h = t.getUTCHours();
  let hh: 0 | 6 | 12 | 18;
  if (h >= 18) hh = 18;
  else if (h >= 12) hh = 12;
  else if (h >= 6) hh = 6;
  else hh = 0;
  const latestRunUnix = Date.UTC(t.getUTCFullYear(), t.getUTCMonth(), t.getUTCDate(), hh) / 1000;
  // Next nominal run after `latestRunUnix` is +6h; it becomes available `lag` h later.
  const nextRunNominal = latestRunUnix + 6 * 3600;
  const nextRunAvailableUnix = nextRunNominal + lag * 3600;
  return { latestRunUnix, nextRunAvailableUnix };
}

export function pickRun(
  at: Date,
  leadSafetyHours = 4,
): { runDateUtc: string; runHourUtc: 0 | 6 | 12 | 18; runUnix: number } {
  // Subtract the publication-lag safety so we don't try to fetch a run that
  // hasn't been published yet.
  const t = new Date(at.getTime() - leadSafetyHours * 3600 * 1000);
  const h = t.getUTCHours();
  let hh: 0 | 6 | 12 | 18;
  if (h >= 18) hh = 18;
  else if (h >= 12) hh = 12;
  else if (h >= 6) hh = 6;
  else hh = 0;
  const yyyy = t.getUTCFullYear();
  const mm = String(t.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(t.getUTCDate()).padStart(2, '0');
  const runDateUtc = `${yyyy}-${mm}-${dd}`;
  const runUnix = Date.UTC(yyyy, t.getUTCMonth(), t.getUTCDate(), hh) / 1000;
  return { runDateUtc, runHourUtc: hh, runUnix };
}
