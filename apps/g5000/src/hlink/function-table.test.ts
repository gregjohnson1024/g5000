import { describe, it, expect } from 'vitest';
import { hlinkFormat, FUNCTION_TABLE, CHANNEL_TO_FUNCTIONS } from './function-table.js';
import type { ChannelValue } from '@g5000/core';

const scalar = (v: number, unit?: string): ChannelValue => ({
  kind: 'scalar',
  value: v,
  unit,
});

describe('hlinkFormat — speed conversions', () => {
  it('fn 65 (boat.speed.water): 2 m/s → 3.89 kn', () => {
    expect(hlinkFormat(65, scalar(2, 'm/s'))).toBe('3.89');
  });
  it('fn 77 (apparent wind speed): 5.144 m/s ≈ 10 kn', () => {
    expect(hlinkFormat(77, scalar(5.144, 'm/s'))).toBe('10.00');
  });
  it('fn 235 (sog) zero', () => {
    expect(hlinkFormat(235, scalar(0))).toBe('0.00');
  });
});

describe('hlinkFormat — angle conversions', () => {
  it('fn 81 (aw angle): π/2 rad → 90.00 deg', () => {
    expect(hlinkFormat(81, scalar(Math.PI / 2))).toBe('90.00');
  });
  it('fn 81 negative angle (port wind) stays signed', () => {
    expect(hlinkFormat(81, scalar(-Math.PI / 4))).toBe('-45.00');
  });
  it('fn 53 (optimum wind angle, abs): -π/4 → 45.00', () => {
    expect(hlinkFormat(53, scalar(-Math.PI / 4))).toBe('45.00');
  });
  it('fn 83 (target twa upwind, signed): -π/4 → -45.00', () => {
    expect(hlinkFormat(83, scalar(-Math.PI / 4))).toBe('-45.00');
  });
  it('fn 109 (true wind direction) wraps to 0..360', () => {
    // -π/2 rad = -90 deg → wraps to 270.00
    expect(hlinkFormat(109, scalar(-Math.PI / 2))).toBe('270.00');
  });
  it('fn 233 (cog) wraps to 0..360', () => {
    expect(hlinkFormat(233, scalar(-Math.PI))).toBe('180.00');
  });
  it('fn 73 (heading.magnetic) wraps to 0..360', () => {
    // 2π → 360.00 wraps to 0.00
    expect(hlinkFormat(73, scalar(2 * Math.PI))).toBe('0.00');
  });
});

describe('hlinkFormat — passthrough units', () => {
  it('fn 193 (depth, meters) passthrough', () => {
    expect(hlinkFormat(193, scalar(12.345))).toBe('12.35');
  });
  it('fn 124 (percentPolar) 1 dp', () => {
    expect(hlinkFormat(124, scalar(87.42))).toBe('87.4');
  });
});

describe('hlinkFormat — unmapped functions and wrong kinds', () => {
  it('returns null for an unmapped function number', () => {
    expect(hlinkFormat(999, scalar(1))).toBeNull();
  });
  it('returns null for a non-scalar kind on a scalar function', () => {
    const geo: ChannelValue = { kind: 'geo', value: { lat: 0, lon: 0 } };
    expect(hlinkFormat(65, geo)).toBeNull();
  });
});

describe('FUNCTION_TABLE structure', () => {
  it('contains all required function numbers', () => {
    const expected = [
      11, 52, 53, 65, 73, 77, 81, 83, 85, 89, 109, 124, 125, 127, 155, 193, 233, 235, 285,
    ];
    for (const fn of expected) {
      expect(FUNCTION_TABLE.has(fn)).toBe(true);
    }
  });
});

describe('CHANNEL_TO_FUNCTIONS reverse map', () => {
  it('maps performance.target.twaUpwind to BOTH fn 53 and 83', () => {
    const fns = CHANNEL_TO_FUNCTIONS.get('performance.target.twaUpwind');
    expect(fns).toBeDefined();
    expect(new Set(fns)).toEqual(new Set([53, 83]));
  });
  it('maps boat.speed.water to fn 65', () => {
    expect(CHANNEL_TO_FUNCTIONS.get('boat.speed.water')).toEqual([65]);
  });
  it('returns undefined for an unknown channel', () => {
    expect(CHANNEL_TO_FUNCTIONS.get('nope.nope.nope')).toBeUndefined();
  });
});
