import { describe, it, expect } from 'vitest';
import type { JsonSafeSample } from '@g5000/core';
import { scalar, enumVal, geo, fmtSpeed, fmtAngleSigned, fmtHeadingRad } from './tile-helpers';

const s = (v: JsonSafeSample['value']): JsonSafeSample =>
  ({ channel: 'x', t_ns: '0', value: v, source: 'test' }) as unknown as JsonSafeSample;

describe('value extractors', () => {
  it('scalar returns the number only for scalar samples', () => {
    expect(scalar(s({ kind: 'scalar', value: 3.4 }))).toBe(3.4);
    expect(scalar(s({ kind: 'enum', value: 'x' }))).toBeNull();
    expect(scalar(undefined)).toBeNull();
  });
  it('enumVal returns the string only for enum samples', () => {
    expect(enumVal(s({ kind: 'enum', value: 'upwind' }))).toBe('upwind');
    expect(enumVal(s({ kind: 'scalar', value: 1 }))).toBeNull();
  });
  it('geo returns lat/lon only for geo samples', () => {
    expect(geo(s({ kind: 'geo', value: { lat: 1, lon: 2 } }))).toEqual({ lat: 1, lon: 2 });
    expect(geo(s({ kind: 'scalar', value: 1 }))).toBeNull();
  });
});

describe('formatters', () => {
  it('fmtSpeed converts m/s to knots, 1 dp, — when absent', () => {
    expect(fmtSpeed(s({ kind: 'scalar', value: 0.514444 }))).toBe('1.0');
    expect(fmtSpeed(undefined)).toBe('—');
  });
  it('fmtAngleSigned shows signed degrees, — when absent', () => {
    expect(fmtAngleSigned(s({ kind: 'scalar', value: Math.PI / 4 }))).toBe('+45');
    expect(fmtAngleSigned(s({ kind: 'scalar', value: -Math.PI / 4 }))).toBe('-45');
    expect(fmtAngleSigned(undefined)).toBe('—');
  });
  it('fmtHeadingRad normalizes into [0,360) and — for null', () => {
    expect(fmtHeadingRad(0)).toBe('0');
    expect(fmtHeadingRad(-Math.PI / 2)).toBe('270');
    expect(fmtHeadingRad(2 * Math.PI)).toBe('0');
    expect(fmtHeadingRad(null)).toBe('—');
  });
});
