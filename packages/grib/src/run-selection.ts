/**
 * Choose the most recent ECMWF Open Data IFS run that should be fully posted
 * for the given time. ECMWF's 0.25° open data lands on the public mirror
 * ~7–9 h after the nominal run start (slower than GFS). A 6 h lag was too
 * optimistic: in the ~2 h window after a run's nominal time it would point at a
 * run that hadn't been disseminated yet, so every fetch 404'd (and the /chart
 * ROI looked perpetually "newer available" while showing nothing). 9 h keeps us
 * on the previous, definitely-published run until the new one is reliably up.
 */
export function pickEcmwfRun(atUnixSec: number): {
  runDateUtc: string;
  runHourUtc: 0 | 6 | 12 | 18;
} {
  const lagMs = 9 * 60 * 60 * 1000;
  const d = new Date(atUnixSec * 1000 - lagMs);
  const hour = d.getUTCHours();
  const runHour = (Math.floor(hour / 6) * 6) as 0 | 6 | 12 | 18;
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return { runDateUtc: `${y}-${m}-${day}`, runHourUtc: runHour };
}
