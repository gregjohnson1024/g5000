import { describe, expect, it } from 'vitest';
import {
  UTC_CLOCK,
  fmtClockSuffix,
  fmtClockTime,
  fmtHourLabel,
  fmtTimestamp,
  parseDatetimeLocalInput,
  resolveClock,
  suggestedOffsetMin,
  toDatetimeLocalInput,
  type ShipClock,
} from './tz';

// 2026-07-09 02:16:20Z
const T = Date.UTC(2026, 6, 9, 2, 16, 20) / 1000;

const SHIP_M4: ShipClock = { mode: 'ship', offsetMin: -240 };
const SHIP_P530: ShipClock = { mode: 'ship', offsetMin: 330 };

describe('suggestedOffsetMin', () => {
  it('gives the nautical zone for Bristol RI (-71.128 → UTC-5)', () => {
    expect(suggestedOffsetMin(-71.128)).toBe(-5 * 60);
  });
  it('is symmetric east/west', () => {
    expect(suggestedOffsetMin(71.128)).toBe(5 * 60);
  });
  it('rounds at the 7.5° zone boundary', () => {
    expect(suggestedOffsetMin(7.4)).toBe(0);
    expect(suggestedOffsetMin(7.6)).toBe(60);
  });
  it('gives ±12 either side of the date line', () => {
    expect(suggestedOffsetMin(179.9)).toBe(12 * 60);
    expect(suggestedOffsetMin(-179.9)).toBe(-12 * 60);
  });
  it('handles unwrapped longitudes', () => {
    expect(suggestedOffsetMin(360 - 71.128)).toBe(-5 * 60);
  });
});

describe('resolveClock', () => {
  it('utc mode ignores the offset entirely', () => {
    expect(resolveClock({ mode: 'utc', offsetMin: -240 }, -71)).toEqual(UTC_CLOCK);
  });
  it('ship + explicit offset wins over GPS', () => {
    expect(resolveClock({ mode: 'ship', offsetMin: -240 }, -71)).toEqual(SHIP_M4);
  });
  it('ship + auto derives from longitude', () => {
    expect(resolveClock({ mode: 'ship', offsetMin: null }, -71.128)).toEqual({
      mode: 'ship',
      offsetMin: -300,
    });
  });
  it('ship + auto with no fix degrades to offset 0', () => {
    expect(resolveClock({ mode: 'ship', offsetMin: null }, null)).toEqual({
      mode: 'ship',
      offsetMin: 0,
    });
  });
});

describe('fmtClockSuffix', () => {
  it('is Z in utc mode', () => expect(fmtClockSuffix(UTC_CLOCK)).toBe('Z'));
  it('renders whole hours compactly', () => expect(fmtClockSuffix(SHIP_M4)).toBe('-4'));
  it('renders half hours with minutes', () => expect(fmtClockSuffix(SHIP_P530)).toBe('+5:30'));
  it('renders ship offset 0 as +0 (still distinct from Z)', () =>
    expect(fmtClockSuffix({ mode: 'ship', offsetMin: 0 })).toBe('+0'));
});

describe('formatters', () => {
  it('fmtTimestamp in UTC matches the historic format', () => {
    expect(fmtTimestamp(T, UTC_CLOCK)).toBe('2026-07-09 02:16Z');
  });
  it('fmtTimestamp shifts and suffixes in ship mode (crosses midnight)', () => {
    expect(fmtTimestamp(T, SHIP_M4)).toBe('2026-07-08 22:16-4');
  });
  it('fmtHourLabel shows shifted wall time + suffix', () => {
    expect(fmtHourLabel(T, UTC_CLOCK)).toBe('02:16Z 09 Jul');
    expect(fmtHourLabel(T, SHIP_M4)).toBe('22:16-4 08 Jul');
  });
  it('fmtClockTime includes seconds', () => {
    expect(fmtClockTime(T, UTC_CLOCK)).toBe('02:16:20Z');
    expect(fmtClockTime(T, SHIP_P530)).toBe('07:46:20+5:30');
  });
});

describe('datetime-local round trip', () => {
  it('renders wall time in the ship zone', () => {
    expect(toDatetimeLocalInput(T, UTC_CLOCK)).toBe('2026-07-09T02:16');
    expect(toDatetimeLocalInput(T, SHIP_M4)).toBe('2026-07-08T22:16');
  });
  it('parse is the exact inverse in every mode', () => {
    for (const clock of [UTC_CLOCK, SHIP_M4, SHIP_P530]) {
      const s = toDatetimeLocalInput(T, clock);
      expect(parseDatetimeLocalInput(s, clock)).toBe(Math.floor(T / 60) * 60);
    }
  });
  it('is independent of the host timezone (no local-time getters)', () => {
    // 22:16 entered as ship -4 wall time = 02:16Z next day.
    expect(parseDatetimeLocalInput('2026-07-08T22:16', SHIP_M4)).toBe(
      Date.UTC(2026, 6, 9, 2, 16, 0) / 1000,
    );
  });
});
