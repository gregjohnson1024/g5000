import { describe, it, expect } from 'vitest';
import { currentNow, nextCurrentEvent } from './current-prediction.js';
import type { CurrentPrediction, CurrentEvent } from './current-prediction.js';

const min = 60_000;
const preds: CurrentPrediction[] = [
  { timeMs: 0, speedKn: 1.0, dirDeg: 350 },
  { timeMs: 60 * min, speedKn: 3.0, dirDeg: 10 },
];

describe('currentNow', () => {
  it('interpolates speed linearly and direction circularly', () => {
    const r = currentNow(preds, 30 * min);
    expect(r).not.toBeNull();
    expect(r!.speedKn).toBeCloseTo(2.0, 6);
    expect(r!.dirDeg).toBeCloseTo(0, 4); // circular midpoint of 350 and 10 is 0, NOT 180
  });
  it('returns the endpoints', () => {
    expect(currentNow(preds, 0)!.speedKn).toBeCloseTo(1.0, 6);
    expect(currentNow(preds, 60 * min)!.speedKn).toBeCloseTo(3.0, 6);
  });
  it('returns null when not bracketed', () => {
    expect(currentNow(preds, -1)).toBeNull();
    expect(currentNow(preds, 61 * min)).toBeNull();
    expect(currentNow([], 0)).toBeNull();
  });
});

describe('nextCurrentEvent', () => {
  const events: CurrentEvent[] = [
    { timeMs: 0, speedKn: 0, kind: 'slack' },
    { timeMs: 60 * min, speedKn: 3.0, kind: 'flood' },
  ];
  it('returns the first event strictly after now', () => {
    expect(nextCurrentEvent(events, 30 * min)?.kind).toBe('flood');
  });
  it('returns null when none remain', () => {
    expect(nextCurrentEvent(events, 61 * min)).toBeNull();
  });
});
