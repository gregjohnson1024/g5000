import { describe, it, expect } from 'vitest';
import { openPeriodStart, type TrackAnnotation } from './track-annotations';

function a(tsMs: number, label: string, kind: TrackAnnotation['kind']): TrackAnnotation {
  return { tsMs, label, kind };
}

describe('openPeriodStart', () => {
  it('returns null for an empty array', () => {
    expect(openPeriodStart([])).toBeNull();
  });

  it('returns null when there are only event annotations', () => {
    expect(openPeriodStart([a(1, 'Tack', 'event'), a(2, 'J3', 'event')])).toBeNull();
  });

  it('returns the periodStart when no periodEnd follows', () => {
    const start = a(10, 'Start period', 'periodStart');
    expect(openPeriodStart([a(5, 'Tack', 'event'), start])).toEqual(start);
  });

  it('returns null when periodStart is followed by periodEnd', () => {
    expect(
      openPeriodStart([a(10, 'Start period', 'periodStart'), a(20, 'End period', 'periodEnd')]),
    ).toBeNull();
  });

  it('returns the most recent open period when there are two', () => {
    const second = a(40, 'Start period', 'periodStart');
    expect(
      openPeriodStart([
        a(10, 'Start period', 'periodStart'),
        a(20, 'End period', 'periodEnd'),
        a(30, 'Tack', 'event'),
        second,
      ]),
    ).toEqual(second);
  });

  it('uses array order — does not re-sort by tsMs', () => {
    const start = a(100, 'Start period', 'periodStart');
    expect(openPeriodStart([a(50, 'End period', 'periodEnd'), start])).toEqual(start);
  });
});
