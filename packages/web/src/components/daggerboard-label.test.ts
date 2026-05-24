import { describe, expect, it } from 'vitest';
import { daggerboardLabel } from './daggerboard-label';

describe('daggerboardLabel', () => {
  it('uses up/down at the extremes', () => {
    expect(daggerboardLabel('port', 0)).toBe('Port board up');
    expect(daggerboardLabel('starboard', 100)).toBe('Stbd board down');
  });
  it('uses percent in the middle', () => {
    expect(daggerboardLabel('port', 75)).toBe('Port board 75%');
    expect(daggerboardLabel('starboard', 50)).toBe('Stbd board 50%');
  });
});
