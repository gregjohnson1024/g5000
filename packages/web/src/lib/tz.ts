/**
 * Shared helpers for the Local/UTC display toggle.
 *
 * Marine nav defaults to UTC, but a passage running in a local timezone is
 * easier to plan around (departure tonight at 18:00 means 18:00 here, not
 * 22:00Z). A page-level toggle lets the user pick — the helpers below
 * format and parse timestamps consistently under either choice.
 *
 * Convention: the WHOLE page is in one mode at a time. Per-panel mixing
 * is what the user-feedback memory warns against. Where a control takes
 * the opposite zone (e.g. `datetime-local` always renders in the
 * browser's local-time UI), we show the equivalent in the other zone as
 * a small subtitle.
 */

export type TzMode = 'utc' | 'local';

/** Read a persisted TzMode from a localStorage key; falls back to `dflt`. */
export function readTzMode(key: string, dflt: TzMode): TzMode {
  try {
    const raw = localStorage.getItem(key);
    if (raw === 'utc' || raw === 'local') return raw;
  } catch {
    /* SSR or quota — keep default */
  }
  return dflt;
}

export function writeTzMode(key: string, tz: TzMode): void {
  try {
    localStorage.setItem(key, tz);
  } catch {
    /* SSR or quota — silently drop */
  }
}

/** Format a UNIX seconds timestamp into the YYYY-MM-DDTHH:MM string a
 *  native `datetime-local` input expects. The output's "parts" zone is
 *  what the user wants to see/type — not the storage zone. */
export function toDatetimeLocalInput(unixSec: number, tz: TzMode): string {
  const d = new Date(unixSec * 1000);
  const pad = (n: number): string => String(n).padStart(2, '0');
  if (tz === 'utc') {
    return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}T${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`;
  }
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** Inverse of {@link toDatetimeLocalInput}: parse the input string under
 *  the chosen timezone interpretation, return UNIX seconds. */
export function parseDatetimeLocalInput(s: string, tz: TzMode): number {
  // Browsers parse `YYYY-MM-DDTHH:MM` as local-time; appending Z forces UTC.
  return new Date(tz === 'utc' ? `${s}:00Z` : `${s}:00`).getTime() / 1000;
}

/** Format an absolute UNIX seconds value for display, suffix-tagged with
 *  Z (UTC) or nothing (local). */
export function fmtTimestamp(unixSec: number, tz: TzMode): string {
  const d = new Date(unixSec * 1000);
  const pad = (n: number): string => String(n).padStart(2, '0');
  if (tz === 'utc') {
    return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}Z`;
  }
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** "HH:MMZ DD MMM" (UTC) or "HH:MM DD MMM" (local). Compact label for
 *  axis ticks and timeline markers. */
export function fmtHourLabel(unixSec: number, tz: TzMode): string {
  const d = new Date(unixSec * 1000);
  if (tz === 'utc') {
    const hh = String(d.getUTCHours()).padStart(2, '0');
    const mm = String(d.getUTCMinutes()).padStart(2, '0');
    const dd = String(d.getUTCDate()).padStart(2, '0');
    const mon = d.toLocaleString('en-GB', { month: 'short', timeZone: 'UTC' });
    return `${hh}:${mm}Z ${dd} ${mon}`;
  }
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  const mon = d.toLocaleString('en-GB', { month: 'short' });
  return `${hh}:${mm} ${dd} ${mon}`;
}
