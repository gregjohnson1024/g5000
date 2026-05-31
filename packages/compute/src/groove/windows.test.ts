import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import {
  timeWeightedFraction,
  circularStdDev,
  coefficientOfVariation,
  reversalsPerMinute,
  maxRisingSlope,
} from './windows.js';

const ns = (sec: number): bigint => BigInt(Math.round(sec * 1e9));

describe('timeWeightedFraction', () => {
  it('returns null with fewer than two samples', () => {
    expect(timeWeightedFraction([])).toBeNull();
    expect(timeWeightedFraction([{ t_ns: ns(0), flag: true }])).toBeNull();
  });
  it('weights intervals by the flag at their start', () => {
    const r = timeWeightedFraction([
      { t_ns: ns(0), flag: true },
      { t_ns: ns(1), flag: false },
      { t_ns: ns(3), flag: false },
    ]);
    expect(r).toBeCloseTo(1 / 3, 6);
  });
  it('is always within [0,1] (property)', () => {
    fc.assert(
      fc.property(
        fc.array(fc.record({ s: fc.integer({ min: 0, max: 1000 }), f: fc.boolean() }), { minLength: 2, maxLength: 50 }),
        (xs) => {
          const sorted = xs.map((x, i) => ({ t_ns: ns(x.s + i * 0.001), flag: x.f })).sort((a, b) => Number(a.t_ns - b.t_ns));
          const r = timeWeightedFraction(sorted);
          return r === null || (r >= 0 && r <= 1);
        },
      ),
    );
  });
});

describe('circularStdDev', () => {
  it('is ~0 for identical angles', () => {
    expect(circularStdDev([0.3, 0.3, 0.3])).toBeCloseTo(0, 6);
  });
  it('handles the ±π wrap (values near +π and −π are close)', () => {
    const sd = circularStdDev([Math.PI - 0.01, -Math.PI + 0.01]);
    expect(sd).toBeLessThan(0.1);
  });
  it('returns null when empty', () => {
    expect(circularStdDev([])).toBeNull();
  });
  it('is non-negative (property)', () => {
    fc.assert(
      fc.property(fc.array(fc.double({ min: -Math.PI, max: Math.PI, noNaN: true }), { minLength: 1, maxLength: 50 }), (xs) => {
        const sd = circularStdDev(xs);
        return sd !== null && sd >= 0;
      }),
    );
  });
});

describe('coefficientOfVariation', () => {
  it('returns 0 for constant values', () => {
    expect(coefficientOfVariation([3, 3, 3])).toBeCloseTo(0, 6);
  });
  it('returns null when empty or mean ~0', () => {
    expect(coefficientOfVariation([])).toBeNull();
    expect(coefficientOfVariation([0, 0])).toBeNull();
  });
});

describe('reversalsPerMinute', () => {
  it('counts direction changes above the dead-band', () => {
    const r = reversalsPerMinute(
      [
        { t_ns: ns(0), value: 0 },
        { t_ns: ns(1), value: 0.2 },
        { t_ns: ns(2), value: 0.4 },
        { t_ns: ns(3), value: 0.1 },
        { t_ns: ns(4), value: 0.3 },
      ],
      0.05,
    );
    expect(r).toBeCloseTo((2 / 4) * 60, 6);
  });
  it('ignores movements within the dead-band', () => {
    const r = reversalsPerMinute(
      [
        { t_ns: ns(0), value: 0 },
        { t_ns: ns(1), value: 0.01 },
        { t_ns: ns(2), value: -0.01 },
        { t_ns: ns(3), value: 0.01 },
      ],
      0.05,
    );
    expect(r).toBe(0);
  });
  it('returns null with insufficient samples', () => {
    expect(reversalsPerMinute([{ t_ns: ns(0), value: 0 }], 0.05)).toBeNull();
  });
});

describe('maxRisingSlope', () => {
  it('returns the largest positive d(value)/dt in m/s²', () => {
    const r = maxRisingSlope([
      { t_ns: ns(0), value: 1 },
      { t_ns: ns(1), value: 1.5 },
      { t_ns: ns(2), value: 3 },
      { t_ns: ns(3), value: 2 },
    ]);
    expect(r).toBeCloseTo(1.5, 6);
  });
  it('returns null with insufficient samples', () => {
    expect(maxRisingSlope([])).toBeNull();
  });
});
