import { describe, it, expect } from 'vitest';
import { holdFraction, isComplete } from './hold-progress';

describe('holdFraction', () => {
  it('returns 0 at elapsed=0', () => {
    expect(holdFraction(0, 800)).toBe(0);
  });

  it('returns 0.5 at elapsed=400 of 800', () => {
    expect(holdFraction(400, 800)).toBe(0.5);
  });

  it('returns 1 at elapsed=800 of 800', () => {
    expect(holdFraction(800, 800)).toBe(1);
  });

  it('clamps to 1 when elapsed exceeds holdMs', () => {
    expect(holdFraction(1200, 800)).toBe(1);
    expect(holdFraction(9999, 800)).toBe(1);
  });

  it('returns 1 immediately when holdMs=0', () => {
    expect(holdFraction(0, 0)).toBe(1);
  });

  it('works with non-default holdMs values (600, 1500)', () => {
    expect(holdFraction(300, 600)).toBe(0.5);
    expect(holdFraction(750, 1500)).toBe(0.5);
  });
});

describe('isComplete', () => {
  it('returns true when fraction is exactly 1', () => {
    expect(isComplete(1)).toBe(true);
  });

  it('returns false when fraction is 0.99', () => {
    expect(isComplete(0.99)).toBe(false);
  });

  it('returns false at 0', () => {
    expect(isComplete(0)).toBe(false);
  });

  it('returns false at 0.5', () => {
    expect(isComplete(0.5)).toBe(false);
  });

  it('returns true for values > 1 (overflow guard)', () => {
    expect(isComplete(1.01)).toBe(true);
  });
});

// Smoke: confirm the exports are functions (not undefined)
describe('module exports', () => {
  it('holdFraction is a function', () => {
    expect(typeof holdFraction).toBe('function');
  });

  it('isComplete is a function', () => {
    expect(typeof isComplete).toBe('function');
  });
});
