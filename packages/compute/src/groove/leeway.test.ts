import { describe, it, expect } from 'vitest';
import { leewayRad } from './leeway.js';

describe('leewayRad', () => {
  it('is zero when k is zero (disabled)', () => {
    expect(leewayRad({ heelRad: 0.1, stwMs: 3, k: 0, maxRad: 0.2, stwFloorMs: 0.5 })).toBe(0);
  });
  it('follows λ = k·heel / STW²', () => {
    expect(leewayRad({ heelRad: 0.1, stwMs: 2, k: 4, maxRad: 1, stwFloorMs: 0.5 })).toBeCloseTo(0.1, 9);
  });
  it('clamps the STW floor to avoid blow-up at low speed', () => {
    expect(leewayRad({ heelRad: 0.1, stwMs: 0.1, k: 4, maxRad: 0.2, stwFloorMs: 0.5 })).toBeCloseTo(0.2, 9);
  });
  it('preserves heel sign and clamps magnitude', () => {
    expect(leewayRad({ heelRad: -0.5, stwMs: 1, k: 10, maxRad: 0.2, stwFloorMs: 0.5 })).toBeCloseTo(-0.2, 9);
  });
});
