import { describe, it, expect } from 'vitest';
import { parsePollMs } from './index.js';

describe('parsePollMs', () => {
  it('converts a valid numeric string to milliseconds', () => {
    expect(parsePollMs('30')).toBe(30_000);
    expect(parsePollMs('15')).toBe(15_000);
    expect(parsePollMs('60')).toBe(60_000);
  });

  it('falls back to 15 000 ms for NaN (non-numeric string)', () => {
    expect(parsePollMs('not-a-number')).toBe(15_000);
    expect(parsePollMs('')).toBe(15_000);
  });

  it('falls back to 15 000 ms for zero', () => {
    expect(parsePollMs('0')).toBe(15_000);
  });

  it('falls back to 15 000 ms for negative values', () => {
    expect(parsePollMs('-5')).toBe(15_000);
    expect(parsePollMs('-1')).toBe(15_000);
  });

  it('falls back to 15 000 ms for undefined (env var not set)', () => {
    expect(parsePollMs(undefined)).toBe(15_000);
  });

  it('accepts fractional seconds', () => {
    // 0.5 s is valid (positive finite) — don't clamp it
    expect(parsePollMs('0.5')).toBe(500);
  });
});
