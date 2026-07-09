/**
 * Ship-clock helpers — the single formatting path for every wall-clock
 * timestamp the UI renders.
 *
 * The boat runs ONE app-wide clock (synced over /api/mast/stream like the
 * theme): either UTC (z-suffixed, the historic convention) or "ship time" —
 * UTC plus a fixed minute offset, rendered with a ±H[:MM] suffix so the two
 * modes can never be confused. The offset is either set explicitly or
 * derived from the GPS longitude via nautical time zones (round(lon/15) h).
 *
 * Never use Date's local-time getters (getHours etc.) for display: they
 * follow the *device's* OS timezone, which on the Pi is not the boat's zone,
 * and they make SSR text differ from client text (React #418). Everything
 * here shifts the instant by the ship offset and reads UTC parts, which is
 * deterministic on server and client alike.
 */

/** 'utc' renders z-suffixed UTC; 'ship' renders UTC + a fixed offset. */
export type ClockMode = 'utc' | 'ship';

/** Boat-wide persisted config. offsetMin null = auto from GPS longitude. */
export interface ClockConfig {
  mode: ClockMode;
  offsetMin: number | null;
}

/** Resolved clock every formatter takes: offsetMin is concrete (utc → 0). */
export interface ShipClock {
  mode: ClockMode;
  offsetMin: number;
}

/** The default / fallback clock — plain UTC. */
export const UTC_CLOCK: ShipClock = { mode: 'utc', offsetMin: 0 };

/**
 * Nautical-zone offset suggested by a GPS longitude: 15°-wide zones centred
 * on multiples of 15°E/W, i.e. round(lon/15) hours. Longitude is normalised
 * to [-180, 180) first; the result is clamped to ±12 h.
 */
export function suggestedOffsetMin(lonDeg: number): number {
  const lon = ((((lonDeg + 180) % 360) + 360) % 360) - 180;
  const zone = Math.max(-12, Math.min(12, Math.round(lon / 15)));
  return zone * 60;
}

/**
 * Resolve the persisted config into a concrete clock. `lonDeg` feeds the
 * auto (GPS) offset; pass null when there is no fix — auto then falls back
 * to 0 (ship time degrades to UTC rather than guessing).
 */
export function resolveClock(cfg: ClockConfig, lonDeg: number | null): ShipClock {
  if (cfg.mode === 'utc') return UTC_CLOCK;
  const offsetMin =
    cfg.offsetMin !== null ? cfg.offsetMin : lonDeg !== null ? suggestedOffsetMin(lonDeg) : 0;
  return { mode: 'ship', offsetMin };
}

/** 'Z' in UTC mode; '±H' or '±H:MM' in ship mode (e.g. '-4', '+5:30'). */
export function fmtClockSuffix(clock: ShipClock): string {
  if (clock.mode === 'utc') return 'Z';
  const sign = clock.offsetMin < 0 ? '-' : '+';
  const abs = Math.abs(clock.offsetMin);
  const h = Math.floor(abs / 60);
  const m = abs % 60;
  return m === 0 ? `${sign}${h}` : `${sign}${h}:${String(m).padStart(2, '0')}`;
}

/** The instant shifted by the ship offset; read parts with getUTC* only. */
function shifted(unixSec: number, clock: ShipClock): Date {
  return new Date((unixSec + clock.offsetMin * 60) * 1000);
}

/**
 * The shifted instant for bespoke compact renders (axis ticks, meteogram
 * labels) that none of the canned formatters fit. Read parts with getUTC*
 * ONLY — local-time getters reintroduce the device-timezone bug.
 */
export function shiftedDate(unixSec: number, clock: ShipClock): Date {
  return shifted(unixSec, clock);
}

const pad = (n: number): string => String(n).padStart(2, '0');

/** UNIX seconds → 'YYYY-MM-DD HH:MM' + clock suffix (minute resolution). */
export function fmtTimestamp(unixSec: number, clock: ShipClock): string {
  const d = shifted(unixSec, clock);
  return (
    `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} ` +
    `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}${fmtClockSuffix(clock)}`
  );
}

/** UNIX seconds → 'HH:MM<suffix> DD MMM'. Compact axis/timeline label. */
export function fmtHourLabel(unixSec: number, clock: ShipClock): string {
  const d = shifted(unixSec, clock);
  const mon = d.toLocaleString('en-GB', { month: 'short', timeZone: 'UTC' });
  return `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}${fmtClockSuffix(clock)} ${pad(d.getUTCDate())} ${mon}`;
}

/** UNIX seconds → 'HH:MM:SS' + suffix. The AppBar clock lowercases the Z. */
export function fmtClockTime(unixSec: number, clock: ShipClock): string {
  const d = shifted(unixSec, clock);
  return `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}${fmtClockSuffix(clock)}`;
}

/** UNIX seconds → 'HH:MM' + suffix. Popups and table cells. */
export function fmtShortTime(unixSec: number, clock: ShipClock): string {
  const d = shifted(unixSec, clock);
  return `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}${fmtClockSuffix(clock)}`;
}

/** UNIX milliseconds → 'HH:MM:SS.mmm' + suffix. Diagnostics feeds. */
export function fmtClockTimeMs(unixMs: number, clock: ShipClock): string {
  const d = new Date(unixMs + clock.offsetMin * 60_000);
  return (
    `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}` +
    `.${String(d.getUTCMilliseconds()).padStart(3, '0')}${fmtClockSuffix(clock)}`
  );
}

/**
 * UNIX seconds → the ship-clock wall DATE as a 'YYYY-MM-DD' key. Use for
 * grouping rows into days: near midnight the ship date differs from the UTC
 * date, and groups must follow the clock the row labels render in.
 */
export function toDayKey(unixSec: number, clock: ShipClock): string {
  const d = shifted(unixSec, clock);
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}

/** UNIX seconds → 'Thu 09 Jul' (+ ' 2026' with year) in ship wall time. */
export function fmtDayLabel(unixSec: number, clock: ShipClock, opts?: { year?: boolean }): string {
  const d = shifted(unixSec, clock);
  const wd = d.toLocaleString('en-GB', { weekday: 'short', timeZone: 'UTC' });
  const mon = d.toLocaleString('en-GB', { month: 'short', timeZone: 'UTC' });
  const base = `${wd} ${pad(d.getUTCDate())} ${mon}`;
  return opts?.year ? `${base} ${d.getUTCFullYear()}` : base;
}

/**
 * Format a UNIX seconds timestamp into the 'YYYY-MM-DDTHH:MM' string a
 * native `datetime-local` input expects, in the ship clock's wall time.
 */
export function toDatetimeLocalInput(unixSec: number, clock: ShipClock): string {
  const d = shifted(unixSec, clock);
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}T${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`;
}

/** Inverse of {@link toDatetimeLocalInput}: wall time → UNIX seconds. */
export function parseDatetimeLocalInput(s: string, clock: ShipClock): number {
  return new Date(`${s}:00Z`).getTime() / 1000 - clock.offsetMin * 60;
}

/** Coarse human duration from a span in seconds: "Nd Nh" / "Nh Nm" / "Nm". */
export function formatDuration(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const d = Math.floor(h / 24);
  if (d >= 1) return `${d}d ${h % 24}h`;
  if (h >= 1) return `${h}h ${Math.floor((seconds % 3600) / 60)}m`;
  return `${Math.floor(seconds / 60)}m`;
}
