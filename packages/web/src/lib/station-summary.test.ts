import { describe, it, expect } from 'vitest';
import { fmtSetDeg, summarizeCurrent, summarizeTide, CURRENT_KIND_LABEL } from './station-summary';
import type { CurrentPrediction, CurrentEvent, TidalEvent } from '@g5000/tide';

describe('fmtSetDeg', () => {
  it('zero-pads to 3 digits with a degree sign', () => {
    expect(fmtSetDeg(54)).toBe('054°');
    expect(fmtSetDeg(5)).toBe('005°');
    expect(fmtSetDeg(123)).toBe('123°');
  });
  it('wraps 360 and negatives into [0,360)', () => {
    expect(fmtSetDeg(360)).toBe('000°');
    expect(fmtSetDeg(-1)).toBe('359°');
    expect(fmtSetDeg(359.6)).toBe('000°'); // rounds to 360 → 000
  });
});

describe('CURRENT_KIND_LABEL', () => {
  it('maps kinds to display labels', () => {
    expect(CURRENT_KIND_LABEL.slack).toBe('Slack');
    expect(CURRENT_KIND_LABEL.flood).toBe('Max flood');
    expect(CURRENT_KIND_LABEL.ebb).toBe('Max ebb');
  });
});

describe('summarizeCurrent', () => {
  const preds: CurrentPrediction[] = [
    { timeMs: 1000, speedKn: 2, dirDeg: 50 },
    { timeMs: 3000, speedKn: 4, dirDeg: 70 },
  ];
  const events: CurrentEvent[] = [{ timeMs: 5000, speedKn: 0, kind: 'slack' }];

  it('interpolates set/drift at now and returns the next event', () => {
    const s = summarizeCurrent(preds, events, 2000);
    expect(s).not.toBeNull();
    expect(s!.speedKn).toBeCloseTo(3, 6);
    expect(s!.dirDeg).toBeCloseTo(60, 6);
    expect(s!.next?.kind).toBe('slack');
  });
  it('normalizes direction into [0,360)', () => {
    const wrap: CurrentPrediction[] = [
      { timeMs: 1000, speedKn: 1, dirDeg: 350 },
      { timeMs: 3000, speedKn: 1, dirDeg: 370 },
    ];
    const s = summarizeCurrent(wrap, [], 2000);
    expect(s).not.toBeNull();
    expect(s!.dirDeg).toBeGreaterThanOrEqual(0);
    expect(s!.dirDeg).toBeLessThan(360);
  });
  it('returns null when there is no bracketing pair', () => {
    expect(summarizeCurrent(preds, events, 9999)).toBeNull();
    expect(summarizeCurrent([], events, 2000)).toBeNull();
  });
});

describe('summarizeTide', () => {
  const events: TidalEvent[] = [
    { type: 'LW', timeMs: 0, heightM: 0.5 },
    { type: 'HW', timeMs: 21_600_000, heightM: 3.5 },
  ];
  it('returns interpolated height-now, state, and next event', () => {
    const s = summarizeTide(events, 10_800_000);
    expect(s).not.toBeNull();
    expect(s!.heightNowM).toBeCloseTo(2.0, 6);
    expect(s!.next?.type).toBe('HW');
  });
  it('returns null when there is no bracketing pair', () => {
    expect(summarizeTide([], 1000)).toBeNull();
    expect(summarizeTide(events, 99_999_999_999)).toBeNull();
  });
});
