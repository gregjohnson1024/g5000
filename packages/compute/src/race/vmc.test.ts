import { describe, it, expect } from 'vitest';
import { vmc } from './vmc.js';

describe('vmc', () => {
  it('heading directly at mark → vmc = sog', () => {
    expect(vmc(5, 0, 0)).toBeCloseTo(5, 5);
    expect(vmc(5, Math.PI / 4, Math.PI / 4)).toBeCloseTo(5, 5);
  });
  it('perpendicular → vmc = 0', () => {
    expect(vmc(5, 0, Math.PI / 2)).toBeCloseTo(0, 5);
  });
  it('reverse course → vmc = -sog', () => {
    expect(vmc(5, 0, Math.PI)).toBeCloseTo(-5, 5);
  });
  it('wraps angle differences across 0/2π', () => {
    // COG = 359°, bearing = 1°  (2° apart, both near north)
    const cog = (359 * Math.PI) / 180;
    const bearing = (1 * Math.PI) / 180;
    expect(vmc(5, cog, bearing)).toBeCloseTo(5 * Math.cos((2 * Math.PI) / 180), 4);
  });
  it('zero SOG → vmc = 0 regardless of angles', () => {
    expect(vmc(0, 1.2, 3.4)).toBe(0);
  });
});
