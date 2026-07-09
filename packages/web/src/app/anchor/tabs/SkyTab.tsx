'use client';

import { useMemo } from 'react';
import * as SunCalc from 'suncalc';
import { computeSky } from '../../../lib/sky';
import { fmtDayLabel, fmtShortTime } from '../../../lib/tz';
import type { ShipClock } from '../../../lib/tz';
import { useShipClock } from '../../../lib/use-ship-clock';

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Format a Date as ship-clock HH:MM + suffix, or '—' for null (polar night/day). */
function fmtTime(d: Date | null, clock: ShipClock): string {
  if (d === null) return '—';
  return fmtShortTime(d.getTime() / 1000, clock);
}

/** Format milliseconds as 'Xh Ym'. */
function fmtDuration(ms: number | null): string {
  if (ms === null || ms <= 0) return '—';
  const totalMin = Math.round(ms / 60_000);
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  return `${h}h ${m}m`;
}

/** Moon phase name from phase fraction (0–1). */
function phaseName(phase: number): string {
  if (phase < 0.0625 || phase >= 0.9375) return 'New Moon';
  if (phase < 0.1875) return 'Waxing Crescent';
  if (phase < 0.3125) return 'First Quarter';
  if (phase < 0.4375) return 'Waxing Gibbous';
  if (phase < 0.5625) return 'Full Moon';
  if (phase < 0.6875) return 'Waning Gibbous';
  if (phase < 0.8125) return 'Last Quarter';
  return 'Waning Crescent';
}

/** Moon phase emoji for quick visual. */
function phaseEmoji(phase: number): string {
  const i = Math.round(phase * 8) % 8;
  return ['🌑', '🌒', '🌓', '🌔', '🌕', '🌖', '🌗', '🌘'][i] ?? '🌑';
}

interface UpcomingPhase {
  name: string;
  date: Date;
}

/**
 * Scan forward day-by-day from `start` to find the next occurrence of each of
 * the four principal moon phases (New, First Quarter, Full, Last Quarter).
 * Returns them sorted by date, up to `limit` items.
 */
function findUpcomingPhases(start: Date, limit = 4): UpcomingPhase[] {
  // Phase thresholds we're looking for (0-based fractions).
  const targets: { threshold: number; name: string }[] = [
    { threshold: 0.0, name: 'New Moon' },
    { threshold: 0.25, name: 'First Quarter' },
    { threshold: 0.5, name: 'Full Moon' },
    { threshold: 0.75, name: 'Last Quarter' },
  ];

  // Collect at most one instance of each phase.
  const found = new Map<string, UpcomingPhase>();

  const MS_PER_DAY = 24 * 60 * 60_000;
  // A lunar cycle is ~29.5 days; scanning 60 days guarantees we find all four.
  const MAX_DAYS = 60;

  let prevPhase = SunCalc.getMoonIllumination(start).phase;
  for (let d = 1; d <= MAX_DAYS && found.size < limit; d++) {
    const date = new Date(start.getTime() + d * MS_PER_DAY);
    const { phase } = SunCalc.getMoonIllumination(date);

    for (const { threshold, name } of targets) {
      if (found.has(name)) continue;
      // Detect a crossing: the phase value wrapped past the threshold.
      // Phase is a continuous 0→1 value; crossings at 0.0 need wrap handling.
      const prev = prevPhase;
      const curr = phase;
      const crossed =
        threshold === 0.0
          ? prev > 0.875 && curr < 0.125 // wrap: 0.9x → 0.0x
          : prev < threshold && curr >= threshold;
      if (crossed) {
        found.set(name, { name, date });
      }
    }

    prevPhase = phase;
  }

  return Array.from(found.values()).sort((a, b) => a.date.getTime() - b.date.getTime());
}

/** Format a Date as a short day label (e.g. "Sat 12 Jul"). */
function fmtDate(d: Date, clock: ShipClock): string {
  return fmtDayLabel(d.getTime() / 1000, clock);
}

// ── Row component ─────────────────────────────────────────────────────────────

function Row({
  label,
  value,
  dim,
}: {
  label: string;
  value: string;
  dim?: boolean;
}): React.ReactElement {
  return (
    <div className="flex justify-between items-baseline gap-2">
      <span className="text-ink-3 text-[0.611rem] uppercase tracking-wide shrink-0">{label}</span>
      <span className={`font-mono text-xs tabular-nums ${dim ? 'text-ink-3' : 'text-ink-2'}`}>
        {value}
      </span>
    </div>
  );
}

// ── Tab component ─────────────────────────────────────────────────────────────

export function SkyTab({ lat, lon }: { lat: number; lon: number }): React.ReactElement {
  const clock = useShipClock();
  const now = new Date();

  const sky = useMemo(() => computeSky(lat, lon, now), [lat, lon]);

  const upcomingPhases = useMemo(() => findUpcomingPhases(now), []);

  const moonPct = Math.round(sky.moon.illumination * 100);

  return (
    <div className="grid grid-cols-1 gap-3 text-ink-value sm:grid-cols-2">
      {/* Sun column */}
      <div className="flex flex-col gap-1">
        <div className="text-[0.611rem] uppercase tracking-wider text-ink-2 font-medium mb-0.5">
          ☀ Sun
        </div>
        <Row label="Rise" value={fmtTime(sky.sunrise, clock)} />
        <Row label="Set" value={fmtTime(sky.sunset, clock)} />
        <Row label="Day length" value={fmtDuration(sky.dayLengthMs)} />
        <div className="mt-1 text-[0.611rem] uppercase tracking-wider text-ink-3 font-medium">
          Twilight
        </div>
        <Row label="Civil dawn" value={fmtTime(sky.civilDawn, clock)} dim />
        <Row label="Civil dusk" value={fmtTime(sky.civilDusk, clock)} dim />
        <Row label="Nautical dawn" value={fmtTime(sky.nauticalDawn, clock)} dim />
        <Row label="Nautical dusk" value={fmtTime(sky.nauticalDusk, clock)} dim />
        <Row label="Astro dawn" value={fmtTime(sky.astroDawn, clock)} dim />
        <Row label="Astro dusk" value={fmtTime(sky.astroDusk, clock)} dim />
      </div>

      {/* Moon column */}
      <div className="flex flex-col gap-1">
        <div className="text-[0.611rem] uppercase tracking-wider text-ink-2 font-medium mb-0.5">
          {phaseEmoji(sky.moon.phase)} Moon
        </div>
        <Row label="Phase" value={phaseName(sky.moon.phase)} />
        <Row label="Illumination" value={`${moonPct}%`} />
        <Row label="Rise" value={fmtTime(sky.moon.rise, clock)} />
        <Row label="Set" value={fmtTime(sky.moon.set, clock)} />

        {/* Upcoming phases */}
        {upcomingPhases.length > 0 && (
          <>
            <div className="mt-1 text-[0.611rem] uppercase tracking-wider text-ink-3 font-medium">
              Upcoming
            </div>
            {upcomingPhases.map((p) => (
              <Row key={p.name} label={p.name} value={fmtDate(p.date, clock)} dim />
            ))}
          </>
        )}
      </div>
    </div>
  );
}
